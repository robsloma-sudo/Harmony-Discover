// Tiny in-memory hand-off: the cocktail maker leaves its latest change here so
// "Show the bartender" and "Make it at home" can show the server's own text.
import type { ChangedCocktail } from '../services/menuExplore';

export type CurrentDrink = { name: string; baseName: string; changed: ChangedCocktail };
let current: CurrentDrink | null = null;
export const setCurrentDrink = (d: CurrentDrink | null) => { current = d; };
export const getCurrentDrink = () => current;
