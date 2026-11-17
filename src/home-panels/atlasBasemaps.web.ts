// @ts-nocheck
/* Harmony Atlas basemaps, copied VERBATIM from Harmony Atlas (atlas.html, "basemaps" section) so Discover draws the
   exact same maps: OpenFreeMap styles (liberty / positron, recoloured) and Esri World Imagery for Satellite.
   Do not edit here; re-copy from atlas.html when Harmony Atlas changes. Only DUR() and the exports are added. */
const DUR = (ms) => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms);

var OFM='https://tiles.openfreemap.org/styles/',STYLE_CACHE={},BASE='sat',IS3D=false;   /* v12.65: Atlas opens in Satellite (Rob) */
var BASEMAPS=[['midnight','Midnight','th-mid'],['streets','Streets','th-str'],['grey','Light grey','th-grey'],['green','Green & grey','th-green'],['sat','Satellite','th-sat'],['blueprint','Blueprint','th-blue']];
var DARK_BASE={midnight:1,sat:1,blueprint:1};
function getJSON(u){if(STYLE_CACHE[u])return Promise.resolve(JSON.parse(STYLE_CACHE[u]));return fetch(u).then(function(r){return r.text()}).then(function(t){STYLE_CACHE[u]=t;return JSON.parse(t)})}
function recolor(s,map){s.layers.forEach(function(l){var id=l.id,p=l.paint=l.paint||{};for(var i=0;i<map.length;i++){var m=map[i];if(m[0].test(id)&&m[1].split('-')[0]===l.type){p[m[1]]=m[2];break}}});return s}
function buildStyle(name){
 if(name==='brand'){var bm=window.__phgBrandMap;if(!bm)return getJSON(OFM+'positron');return getJSON(OFM+'positron').then(function(s){s=recolor(s,[[/^background$/,'background-color',bm.background],[/^park/,'fill-color',bm.park],[/wood/,'fill-color',bm.wood],[/residential/,'fill-color',bm.residential],[/^water$/,'fill-color',bm.water],[/waterway/,'line-color',bm.waterway],[/^building/,'fill-color',bm.building],[/motorway.*inner|major_inner/,'line-color',bm.major],[/casing/,'line-color',bm.casing],[/minor/,'line-color',bm.minor],[/path/,'line-color',bm.path],[/rail/,'line-color',bm.rail],[/boundary/,'line-color',bm.boundary],[/aeroway/,'line-color',bm.aeroway]]);
   s.layers.forEach(function(l){if(l.type==='symbol'){l.paint=l.paint||{};l.paint['text-color']=bm.text;l.paint['text-halo-color']=bm.halo;l.paint['text-halo-width']=1.2}if(l.type==='line'&&/subtle/.test(l.id))l.paint['line-color']=bm.subtle});return s});}
 if(name==='streets')return getJSON(OFM+'liberty');
 if(name==='grey')return getJSON(OFM+'positron');
 if(name==='green')return getJSON(OFM+'positron').then(function(s){return recolor(s,[
   [/^background$/,'background-color','#eceee8'],[/^park/,'fill-color','#bcdcaa'],[/wood/,'fill-color','#a9d096'],[/residential/,'fill-color','#e4e7e1'],
   [/^water$/,'fill-color','#c4d4dc'],[/waterway/,'line-color','#c4d4dc'],[/^building/,'fill-color','#dfe2dc'],[/motorway.*inner|major_inner/,'line-color','#ffffff'],[/casing/,'line-color','#d2d6cf'],[/minor/,'line-color','#ffffff']])});
 if(name==='midnight'||name==='blueprint')return getJSON(OFM+'positron').then(function(s){var bp=name==='blueprint';
  s=recolor(s,[[/^background$/,'background-color',bp?'#0b1d33':'#060a12'],[/^park/,'fill-color',bp?'#0e2440':'#0a1a17'],[/wood/,'fill-color',bp?'#0e2440':'#0a1915'],[/residential/,'fill-color',bp?'#0c2038':'#080d16'],
   [/^water$/,'fill-color',bp?'#081628':'#081624'],[/waterway/,'line-color',bp?'#123a63':'#0d2236'],[/^building/,'fill-color',bp?'#123459':'#0e1724'],
   [/motorway.*inner|major_inner/,'line-color',bp?'#5aa9ff':'#1f4e63'],[/casing/,'line-color',bp?'#16406b':'#0b1824'],[/minor/,'line-color',bp?'#1d4f80':'#132232'],[/path/,'line-color',bp?'#1d4f80':'#101b28'],
   [/rail/,'line-color',bp?'#2b6aa8':'#1a2836'],[/boundary/,'line-color',bp?'#5aa9ff':'#2a5568'],[/aeroway/,'line-color','#14263a']]);
  s.layers.forEach(function(l){if(l.type==='symbol'){l.paint=l.paint||{};l.paint['text-color']=bp?'#a8d0ff':'#7f98a6';l.paint['text-halo-color']=bp?'#0b1d33':'#05070d';l.paint['text-halo-width']=1.2}if(l.type==='line'&&/subtle/.test(l.id))l.paint['line-color']=bp?'#2b6aa8':'#16303f'});
  return s});
 if(name==='sat')return getJSON(OFM+'positron').then(function(s){
  var labels=s.layers.filter(function(l){return l.type==='symbol'&&/label|name|shield/.test(l.id)}).map(function(l){l=JSON.parse(JSON.stringify(l));l.paint=l.paint||{};l.paint['text-color']='#ffffff';l.paint['text-halo-color']='rgba(0,0,0,.85)';l.paint['text-halo-width']=1.4;return l});
  s.sources.esri={type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:(window.devicePixelRatio||1)>=1.5?128:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}/* v12.63: retina-sharp (next zoom level on 2x screens), keep z19 cap (z20 = grey placeholder tiles in many places) */;
  s.layers=[{id:'bg',type:'background',paint:{'background-color':'#0b0f0c'}},{id:'esri',type:'raster',source:'esri',paint:{'raster-saturation':0,'raster-contrast':.05,'raster-fade-duration':DUR(300)}}].concat(labels);return s});
 return getJSON(OFM+'positron');
}

export const ATLAS_BASEMAPS = BASEMAPS;
export const ATLAS_DEFAULT_BASEMAP = BASE;
export const ATLAS_DARK_BASEMAPS = DARK_BASE;
export const buildAtlasStyle = buildStyle;
