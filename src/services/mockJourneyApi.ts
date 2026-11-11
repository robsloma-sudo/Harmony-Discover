const journeys: Record<string, any> = {
  'paper-plane': { title:'The Paper Plane', intro:'A modern cocktail known for balancing whiskey, citrus and bittersweet flavors.', sections:[
    { heading:'What is it?', body:'The Paper Plane is commonly made with bourbon, Aperol, amaro and fresh lemon juice in equal proportions. Confirm the restaurant’s exact recipe before treating this as its specification.', evidence:'General reference · recipe may vary' },
    { heading:'What does it taste like?', body:'Expect a balance of bright citrus, orange bitterness, whiskey warmth and herbal complexity. Sweetness and bitterness should feel integrated rather than dominant.', evidence:'Flavor interpretation' },
    { heading:'Why is it interesting?', body:'Its equal-part structure makes it an approachable example of modern sour-style cocktail balance.', evidence:'Educational explanation' }
  ]},
  'oaxaca-old-fashioned': { title:'Oaxaca Old Fashioned', intro:'A modern agave-and-whiskey variation on the Old Fashioned family.', sections:[
    { heading:'What is it?', body:'Often built around tequila, mezcal, agave syrup and bitters. Recipes vary by bar; the menu alone may not identify the exact brands.', evidence:'General reference · recipe may vary' },
    { heading:'What might you taste?', body:'Depending on the spirits, expect a combination of agave character, oak, spice and potentially smoke.', evidence:'Flavor interpretation' }
  ]}
};
export function getMockJourney(id: string) {
  return journeys[id] || { title:'A drink worth discovering', intro:'This is a sample Journey. Connect the research and identity services to provide verified information.', sections:[{heading:'Start with the menu',body:'Harmony will explain the drink using its printed description and supporting research.',evidence:'Prototype content'}] };
}
