// Validated categorical palette (see dataviz skill: references/palette.md).
// Fixed order — never cycled or reassigned by filter state.
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#008300', '#e34948'];

// Park identity gets its own fixed slots so BB/GI stay the same color
// everywhere on the dashboard, independent of which chart it's in.
export const PARK_COLOR = { BB: CATEGORICAL[0], GI: CATEGORICAL[1] };

export function colorForIndex(i) {
  return CATEGORICAL[i % CATEGORICAL.length];
}
