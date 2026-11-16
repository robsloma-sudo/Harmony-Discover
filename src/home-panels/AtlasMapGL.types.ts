import type { AtlasLayer, DiscoverVenue } from '../services/phgAtlasRecords';
export type AtlasVenuePin = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  venue_type?: string;
  atlas_layer?: AtlasLayer;
  /** Recent crowd activity (number of shared scans); grows the pin a little. */
  activity?: number;
};

export type AtlasMapGLProps = {
  center: { latitude: number; longitude: number } | null;
  venues: AtlasVenuePin[];
  onSelectVenue?: (id: string, venue?: DiscoverVenue) => void;
  /** Full Atlas mode (Harmony Atlas behaviour): load these layers for whatever is on screen. */
  layers?: AtlasLayer[];
  /** Full Atlas mode: the venues currently drawn as points (empty while showing cluster bubbles). */
  onViewportVenues?: (venues: DiscoverVenue[], clustered: boolean) => void;
  selectedId?: string | null;
  height?: number;
  fullScreen?: boolean;
  fitKey?: string;
};

/** One colour per venue type, shared by the map and the legend. */
export const VENUE_TYPE_COLORS: Record<string, string> = {
  bar: '#3B82F6',
  cocktail_bar: '#3B82F6',
  restaurant: '#22C3A6',
  liquor_store: '#F2A93B',
  brewery: '#E8C547',
  winery: '#C0476B',
  distillery: '#B97AF2',
  hotel: '#8FA3BF',
  other: '#8FA3BF',
};

export const VENUE_TYPE_LABELS: Record<string, string> = {
  bar: 'Bar', cocktail_bar: 'Cocktail bar', restaurant: 'Restaurant', liquor_store: 'Liquor store',
  brewery: 'Brewery', winery: 'Winery', distillery: 'Distillery', hotel: 'Hotel', other: 'Venue',
};
