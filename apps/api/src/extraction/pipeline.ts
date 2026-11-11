import { configuredOcrProvider } from './providers/httpOcrProvider.js';
import { LiteralLineExtractor } from './literalLineExtractor.js';
import { db } from '../lib/supabase.js';

export async function extractObservation(observationId: string) {
  const { data: assets, error } = await db.from('observation_assets')
    .select('id,object_path,mime_type,processing_status').eq('observation_id', observationId).eq('processing_status','validated');
  if (error) throw error;
  if (!assets?.length) throw new Error('No validated assets available for extraction');

  const provider = configuredOcrProvider();
  const pages = [];
  for (let index = 0; index < assets.length; index++) {
    const asset = assets[index];
    const { data: blob, error: downloadError } = await db.storage.from('observation-assets').download(
      (await db.from('observation_extractions').select('normalized_object_path').eq('asset_id',asset.id).single()).data?.normalized_object_path
    );
    if (downloadError || !blob) throw downloadError || new Error('Normalized image unavailable');
    const page = await provider.recognize({
      imageBytes:Buffer.from(await blob.arrayBuffer()),
      mimeType:'image/jpeg',
      pageNumber:index + 1
    });
    pages.push({ ...page, assetId:asset.id });
  }

  const extractor = new LiteralLineExtractor();
  const result = await extractor.extract({
    context:{ observationId, extractionVersion:'literal-lines-0.1' },
    ocr:{ pages, provider:provider.name }
  });

  for (let i=0; i<pages.length; i++) {
    const { error: updateError } = await db.from('observation_extractions')
      .update({ extraction_status:'extracted', ocr_provider:provider.name, ocr_payload:{ text:pages[i].text, confidence:pages[i].confidence ?? null } })
      .eq('asset_id',pages[i].assetId);
    if (updateError) throw updateError;
  }
  await db.from('observation_processing_events').insert({
    observation_id:observationId, event_type:'literal_menu_extraction_complete',
    detail:{ itemCount:result.items.length, pagesProcessed:result.pagesProcessed, extractor:'literal-lines-0.1' }
  });
  return result;
}
