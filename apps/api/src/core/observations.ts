import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, type Result } from './http.ts';
export const BUCKET = 'observation-assets';
export const ALLOWED_MIME: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'};
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_ASSETS_PER_OBSERVATION = 12;
const createSchema=z.object({processingNoticeVersion:z.literal('discover-menu-processing-v1'),venueName:z.string().trim().max(180).optional(),capturedAt:z.string().datetime().optional(),source:z.enum(['camera','gallery']).default('camera')}).strict();
type Log=(m:string,e:unknown)=>void;
export async function createObservation(db:SupabaseClient,subjectId:string,body:unknown,log?:Log):Promise<Result>{const parsed=createSchema.safeParse(body);if(!parsed.success)return ok({error:'invalid_request',details:parsed.error.flatten()},400);const id=crypto.randomUUID();const{error}=await db.from('menu_observations').insert({id,consumer_id:subjectId,status:'created',consent_to_processing:true,processing_notice_version:parsed.data.processingNoticeVersion,venue_name_submitted:parsed.data.venueName??null,capture_source:parsed.data.source,captured_at:parsed.data.capturedAt??new Date().toISOString()});if(error){log?.('observation insert failed',error);return ok({error:'observation_create_failed'},500)}return ok({id,status:'created'},201)}
export async function addAsset(db:SupabaseClient,subjectId:string,observationId:string,file:{bytes:Uint8Array;mimetype:string}|null,log?:Log):Promise<Result>{if(!z.string().uuid().safeParse(observationId).success)return ok({error:'observation_not_found'},404);const{data:observation,error:lookupError}=await db.from('menu_observations').select('id,status').eq('id',observationId).eq('consumer_id',subjectId).maybeSingle();if(lookupError||!observation)return ok({error:'observation_not_found'},404);if(observation.status!=='created')return ok({error:'observation_not_uploadable'},409);const{count:assetCount,error:assetCountError}=await db.from('observation_assets').select('id',{count:'exact',head:true}).eq('observation_id',observationId).eq('consumer_id',subjectId).is('deleted_at',null);if(assetCountError){log?.('observation asset count failed',assetCountError);return ok({error:'asset_count_unavailable'},503)}if((assetCount??0)>=MAX_ASSETS_PER_OBSERVATION)return ok({error:'page_limit_reached',maxPages:MAX_ASSETS_PER_OBSERVATION},413);if(!file)return ok({error:'asset_required'},400);const ext=ALLOWED_MIME[file.mimetype];if(!ext)return ok({error:'unsupported_media_type'},415);if(file.bytes.byteLength===0||file.bytes.byteLength>MAX_UPLOAD_BYTES)return ok({error:'asset_size_invalid'},413);const objectPath=`${subjectId}/${observationId}/${crypto.randomUUID()}.${ext}`;const{error:uploadError}=await db.storage.from(BUCKET).upload(objectPath,file.bytes,{contentType:file.mimetype,upsert:false});if(uploadError){log?.('asset upload failed',uploadError);return ok({error:'asset_upload_failed'},500)}const{error:rowError}=await db.from('observation_assets').insert({observation_id:observationId,consumer_id:subjectId,object_path:objectPath,mime_type:file.mimetype,byte_size:file.bytes.byteLength,processing_status:'received'});if(rowError){log?.('asset metadata insert failed',rowError);const{error:cleanupError}=await db.storage.from(BUCKET).remove([objectPath]);if(cleanupError)log?.('orphaned asset cleanup failed',{cleanupError,objectPath});return ok({error:'asset_metadata_failed'},500)}return ok({status:'received'},201)}
export async function completeObservation(db:SupabaseClient,subjectId:string,observationId:string,log?:Log):Promise<Result>{if(!z.string().uuid().safeParse(observationId).success)return ok({error:'observation_not_completable'},409);const{data,error}=await db.from('menu_observations').update({status:'received'}).eq('id',observationId).eq('consumer_id',subjectId).eq('status','created').select('id,status').maybeSingle();if(error||!data)return ok({error:'observation_not_completable'},409);const{error:queueError}=await db.from('observation_jobs').upsert({observation_id:observationId,job_type:'validate_assets',status:'queued',available_at:new Date().toISOString()},{onConflict:'observation_id,job_type',ignoreDuplicates:true});if(queueError){log?.('job enqueue failed',queueError);return ok({error:'processing_enqueue_failed'},500)}return ok({id:observationId,status:'received',processing:'queued'},202)}
export async function getObservation(db:SupabaseClient,subjectId:string,observationId:string,log?:Log):Promise<Result>{if(!z.string().uuid().safeParse(observationId).success)return ok({error:'observation_not_found'},404);const{data,error}=await db.rpc('discover_observation_result',{p_subject:subjectId,p_observation:observationId});if(error){log?.('observation read failed',error);return ok({error:'observation_read_failed'},500)}if(!data)return ok({error:'observation_not_found'},404);return ok(data)}


/** Remove an incomplete upload owned by the caller. Only observations still in
 * the initial upload state can be discarded; processing scans are preserved. */
export async function discardIncompleteObservation(db: SupabaseClient, subjectId: string, observationId: string, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data: observation, error: lookupError } = await db.from('menu_observations')
    .select('id,status').eq('id', observationId).eq('consumer_id', subjectId).maybeSingle();
  if (lookupError || !observation) return ok({ error: 'observation_not_found' }, 404);
  if (observation.status !== 'created') return ok({ error: 'observation_not_discardable' }, 409);

  const { data: assets, error: assetsError } = await db.from('observation_assets')
    .select('object_path').eq('observation_id', observationId).eq('consumer_id', subjectId);
  if (assetsError) { log?.('incomplete scan asset lookup failed', assetsError); return ok({ error: 'scan_cleanup_failed' }, 500); }
  const paths = (assets ?? []).map((asset: { object_path: string }) => asset.object_path);
  if (paths.length) {
    const { error: storageError } = await db.storage.from(BUCKET).remove(paths);
    if (storageError) { log?.('incomplete scan storage cleanup failed', storageError); return ok({ error: 'scan_cleanup_failed' }, 500); }
  }
  const { error: deleteError } = await db.from('menu_observations')
    .delete().eq('id', observationId).eq('consumer_id', subjectId).eq('status', 'created');
  if (deleteError) { log?.('incomplete scan record cleanup failed', deleteError); return ok({ error: 'scan_cleanup_failed' }, 500); }
  return ok({ discarded: true });
}

/** Atomic, owner-checked correction with append-only before/after audit. */
export async function correctObservationItem(db:SupabaseClient,subjectId:string,observationId:string,itemId:string,body:unknown,log?:Log):Promise<Result>{
 const schema=z.object({changes:z.object({name:z.string().trim().min(1).max(200).optional(),section:z.string().max(80).nullable().optional(),description:z.string().max(600).nullable().optional(),price:z.string().max(40).nullable().optional(),category:z.enum(['cocktail','wine','beer','spirits','non_alcoholic','food','other']).optional()}).strict().refine(v=>Object.keys(v).length>0,'At least one field is required')}).strict();
 const parsed=schema.safeParse(body);if(!parsed.success)return ok({error:'invalid_correction',details:parsed.error.flatten()},400);const c=parsed.data.changes;
 const{data,error}=await db.rpc('discover_correct_observation_item',{p_subject:subjectId,p_observation:observationId,p_item:itemId,p_changes:{...(c.name!==undefined?{name:c.name}:{}),...(c.section!==undefined?{section:c.section}:{}),...(c.description!==undefined?{description:c.description}:{}),...(c.price!==undefined?{price_text:c.price}:{}),...(c.category!==undefined?{beverage_category:c.category}:{})}});
 if(error){if(error.code==='P0002')return ok({error:'observation_item_not_found'},404);if(error.code==='22023')return ok({error:'invalid_correction'},400);log?.('observation item correction failed',error);return ok({error:'correction_save_failed'},500)}return ok({item:data,saved:true});
}


/** Read the caller's contribution-permission state for one owned observation. */
export async function getObservationContribution(db: SupabaseClient, subjectId: string, observationId: string, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data: observation, error: lookupError } = await db.from('menu_observations')
    .select('id,status').eq('id', observationId).eq('consumer_id', subjectId).maybeSingle();
  if (lookupError || !observation) return ok({ error: 'observation_not_found' }, 404);
  const { data, error } = await db.from('observation_contribution_grants')
    .select('id,policy_version,granted_at,withdrawn_at')
    .eq('observation_id', observationId).eq('consumer_id', subjectId)
    .is('withdrawn_at', null).maybeSingle();
  if (error) { log?.('contribution permission lookup failed', error); return ok({ error: 'contribution_permission_unavailable' }, 500); }
  return ok({ granted: !!data, policyVersion: data?.policy_version ?? null, grantedAt: data?.granted_at ?? null });
}

/** Create an explicit, observation-specific contribution grant after review. */
export async function grantObservationContribution(db: SupabaseClient, subjectId: string, observationId: string, body: unknown, log?: Log): Promise<Result> {
  const parsed = z.object({ policyVersion: z.literal('discover-harmony-contribution-v1') }).strict().safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_contribution_permission' }, 400);
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data, error } = await db.rpc('discover_grant_observation_contribution', {
    p_subject: subjectId, p_observation: observationId, p_policy_version: parsed.data.policyVersion
  });
  if (error) {
    if (error.code === '42501') return ok({ error: 'observation_not_eligible' }, 409);
    if (error.code === '23505') return ok({ error: 'contribution_permission_already_active' }, 409);
    log?.('contribution permission grant failed', error);
    return ok({ error: 'contribution_permission_failed' }, 500);
  }
  return ok({ granted: true, grantId: data, policyVersion: parsed.data.policyVersion }, 201);
}

/** Withdraw the active contribution grant while preserving a separate audit event. */
export async function withdrawObservationContribution(db: SupabaseClient, subjectId: string, observationId: string, log?: Log): Promise<Result> {
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data, error } = await db.rpc('discover_withdraw_observation_contribution', {
    p_subject: subjectId, p_observation: observationId
  });
  if (error) { log?.('contribution permission withdrawal failed', error); return ok({ error: 'contribution_withdrawal_failed' }, 500); }
  return ok({ withdrawn: data === true, alreadyInactive: data !== true });
}


/** Confirm the venue identity after the user reviews the extracted menu. */
export async function confirmObservationVenue(db: SupabaseClient, subjectId: string, observationId: string, body: unknown, log?: Log): Promise<Result> {
  const parsed = z.object({ venueName: z.string().trim().min(1).max(180) }).strict().safeParse(body);
  if (!parsed.success) return ok({ error: 'invalid_venue_confirmation' }, 400);
  if (!z.string().uuid().safeParse(observationId).success) return ok({ error: 'observation_not_found' }, 404);
  const { data, error } = await db.from('menu_observations').update({
    venue_name_submitted: parsed.data.venueName,
    venue_confirmed: true,
  }).eq('id', observationId).eq('consumer_id', subjectId).eq('status', 'ready_for_review')
    .select('id,venue_name_submitted,venue_confirmed').maybeSingle();
  if (error) { log?.('venue confirmation failed', error); return ok({ error: 'venue_confirmation_failed' }, 500); }
  if (!data) return ok({ error: 'observation_not_eligible' }, 409);
  return ok({ confirmed: true, venueName: data.venue_name_submitted });
}


/** List active contribution permissions so a signed-in user can manage or withdraw them later. */
export async function listObservationContributions(db: SupabaseClient, subjectId: string, log?: Log): Promise<Result> {
  const { data, error } = await db.from('observation_contribution_grants')
    .select('id,observation_id,policy_version,granted_at,menu_observations!inner(venue_name_submitted,venue_name_read,captured_at,status)')
    .eq('consumer_id', subjectId).is('withdrawn_at', null)
    .order('granted_at', { ascending: false }).limit(100);
  if (error) {
    log?.('contribution permission list failed', error);
    return ok({ error: 'contribution_permissions_unavailable' }, 500);
  }
  type ContributionRow = {
    id: string;
    observation_id: string;
    policy_version: string;
    granted_at: string;
    menu_observations: {
      venue_name_submitted: string | null;
      venue_name_read: string | null;
      captured_at: string | null;
      status: string;
    } | Array<{
      venue_name_submitted: string | null;
      venue_name_read: string | null;
      captured_at: string | null;
      status: string;
    }> | null;
  };
  const contributions = ((data ?? []) as unknown as ContributionRow[]).map(row => {
    const observation = Array.isArray(row.menu_observations) ? row.menu_observations[0] : row.menu_observations;
    return {
      grantId: row.id,
      observationId: row.observation_id,
      policyVersion: row.policy_version,
      grantedAt: row.granted_at,
      venueName: observation?.venue_name_submitted || observation?.venue_name_read || 'Unlabeled venue',
      capturedAt: observation?.captured_at ?? null,
      status: observation?.status ?? 'unknown',
    };
  });
  return ok({ contributions });
}
