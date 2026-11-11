import 'dotenv/config';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { db } from './lib/supabase.js';
import { extractObservation } from './extraction/pipeline.js';

const workerId = `discover-worker-${randomUUID()}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Job = { id:string; observation_id:string; job_type:string; attempts:number; max_attempts:number };

function validImage(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  // HEIC requires a dedicated decoder/container inspection path; reject until implemented.
  return false;
}

async function recordEvent(observationId: string, assetId: string | null, type: string, detail: object = {}) {
  await db.from('observation_processing_events').insert({
    observation_id: observationId, asset_id: assetId, event_type: type, detail
  });
}

async function processValidation(job: Job) {
  const { data: assets, error } = await db.from('observation_assets')
    .select('id,object_path,mime_type,byte_size').eq('observation_id', job.observation_id);
  if (error) throw error;
  if (!assets?.length) throw new Error('No assets attached to observation');

  for (const asset of assets) {
    const { data: blob, error: downloadError } = await db.storage.from('observation-assets').download(asset.object_path);
    if (downloadError || !blob) throw downloadError || new Error('Asset download failed');
    const original = Buffer.from(await blob.arrayBuffer());
    if (original.length !== asset.byte_size) throw new Error(`Asset size mismatch: ${asset.id}`);
    if (!validImage(original, asset.mime_type)) {
      await db.from('observation_assets').update({ processing_status:'rejected' }).eq('id', asset.id);
      await recordEvent(job.observation_id, asset.id, 'asset_rejected', { reason:'signature_or_format_not_supported' });
      continue;
    }

    const digest = createHash('sha256').update(original).digest('hex');
    const normalized = await sharp(original, { failOn:'error' }).rotate().jpeg({ quality:88, mozjpeg:true }).toBuffer();
    const normalizedPath = `${asset.object_path.replace(/\.[^.]+$/, '')}.normalized.jpg`;
    const { error: normalizedUploadError } = await db.storage.from('observation-assets').upload(normalizedPath, normalized, {
      contentType:'image/jpeg', upsert:true
    });
    if (normalizedUploadError) throw normalizedUploadError;

    const { error: updateError } = await db.from('observation_assets')
      .update({ sha256:digest, processing_status:'validated' }).eq('id', asset.id);
    if (updateError) throw updateError;

    const { error: extractionError } = await db.from('observation_extractions').upsert({
      observation_id:job.observation_id, asset_id:asset.id, extraction_status:'ocr_unconfigured',
      sha256:digest, normalized_object_path:normalizedPath
    }, { onConflict:'asset_id' });
    if (extractionError) throw extractionError;
    await recordEvent(job.observation_id, asset.id, 'asset_validated_normalized', {
      sha256:digest, originalBytes:original.length, normalizedBytes:normalized.length,
      metadataStrippedByReencode:true
    });
  }
}

async function runOnce() {
  const { data, error } = await db.rpc('claim_observation_job', { p_worker:workerId }).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const job = data as Job;
  try {
    if (job.job_type === 'validate_assets') {
      await processValidation(job);
      if (process.env.OCR_PROVIDER_URL && process.env.OCR_PROVIDER_API_KEY) {
        const { error: enqueueError } = await db.from('observation_jobs').upsert({
          observation_id:job.observation_id, job_type:'extract_menu', status:'queued',
          available_at:new Date().toISOString()
        }, { onConflict:'observation_id,job_type', ignoreDuplicates:true });
        if (enqueueError) throw enqueueError;
      }
    }
    else throw new Error(`Unsupported job type: ${job.job_type}`);
    const { error: finishError } = await db.from('observation_jobs').update({
      status:'complete', locked_at:null, locked_by:null, last_error:null, updated_at:new Date().toISOString()
    }).eq('id',job.id);
    if (finishError) throw finishError;
    await recordEvent(job.observation_id, null, 'job_complete', { jobType:job.job_type, attempts:job.attempts });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const terminal = job.attempts >= job.max_attempts;
    await db.from('observation_jobs').update({
      status:terminal ? 'failed' : 'retry',
      available_at:new Date(Date.now() + Math.min(60_000 * 2 ** job.attempts, 60 * 60_000)).toISOString(),
      locked_at:null, locked_by:null, last_error:message.slice(0,1000), updated_at:new Date().toISOString()
    }).eq('id',job.id);
    await recordEvent(job.observation_id, null, terminal ? 'job_failed' : 'job_retry', {
      jobType:job.job_type, error:message, attempt:job.attempts
    });
  }
  return true;
}

console.log(`Harmony Discover worker started: ${workerId}`);
while (true) {
  try { const didWork = await runOnce(); if (!didWork) await sleep(1500); }
  catch (error) { console.error('worker loop error', error); await sleep(4000); }
}
