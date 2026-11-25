export type MartyFaceState = 'idle' | 'listening' | 'thinking' | 'talking';
export interface MartyFaceProps { state: MartyFaceState; /** 0 = closed, 1 = wide open; only used while talking */ mouthOpen: number; size: number; }
export type MartyFaceComponent = (props: MartyFaceProps) => React.JSX.Element;
