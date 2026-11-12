// Classification rules for single-park (Gulf Islands) season per cap dashboards.
// Reproduces the published 2025 dashboard to the cent (validated with make.mjs --compare).

export const norm = s => String(s || '').replace(/\s+/g, ' ').trim();

// Product key as the dashboards name products: Rate lines are "event · rate" unless the two are the same.
export const pkey = l => { const n = norm(l.n), e = norm(l.e); return (l.t === 'Rate' && e && e !== n) ? `${e} · ${n}` : n; };

// Admissions: the Waterpark Admission event; in 2024 also season pass scans (a $0 rate with no event).
// Special events (SOAR - Autism Family Day) are not attendance, matching the published 2025 dashboard.
export const isAdmission = l => l.t === 'Rate' && (/waterpark admission/i.test(l.e || '') || /^season pass scan/i.test(norm(l.n)));

// Attendance mix used by the Attendance tile breakdown
export const abOf = n => /season pass (redemption|scan)/i.test(n) ? 'sp' : /employee/i.test(n) ? 'emp' : /^group\b/i.test(n) ? 'grp' : /comp|media|bring a friend|sunshine/i.test(n) ? 'comp' : 'ga';

// Hand-reviewed classifications for products first seen in 2024 (not in the 2025/2026 product lists)
export const OVERRIDE = {
  food: ['Cheez Its', 'Veggie Straws', 'Tummi Yummi', 'Frios', 'Frios (CS)', 'Frios (Employee)', 'Apple Sauce Pouch', 'Bugles & Chex Mix', 'Fritos Pie', 'Add Strawberries', 'Add Whipped Cream', 'Slim Jim', 'fried oreos', 'Box Lunch', 'Extra Powdered Sugar', 'taco', 'Add Condensed Milk', 'Choc Covered Strawberries', 'Add Jalapenos', 'Cinnamon Roll', 'Marinara Sauce', 'Steak (Taco)', 'Chicken (Taco)', 'Corn Tortilla', 'Flour Tortilla', 'Meal Voucher Tickets', 'Buffalo Wild Wings - Gulfport', 'Abramson Si Academy Marching Band - Meal Voucher', 'TEST - Meal Voucher Comp'],
  retail: ['Ladies 2 piece set', 'Cover up long Dress', 'Tank Top', 'Croc Charm', 'Employee Visor', 'Kids Bucket Hat', 'Staff Shirt $10', 'Little Swimmers', 'Silicone Large Cups'],
  ticket: ['Heritage Plastics', 'COMP - COCA COLA', 'Coast Coca Cola', 'Hotel Partnership', 'COMP - Robinson Construction', 'Brian Aluminum Enclosures', 'JZ 94.5 Summer Reading Program', 'Exit Realty Heart Properties', 'Abramson Si Academy Marching Band - One Day Pass', 'Crew Member Admission'],
  otherInPark: ['Airbrush Sales Commission', 'The Shed', 'Sponsorship'],
};

// Fallback name rules for anything not in the product lists or OVERRIDE (reported as unclassified for review)
export const RULES = [
  [/admission|ticket|season pass|two-park|flex|bring a friend|consignment|^gi - .*pass|membership/i, 'ticket'],
  [/locker/i, 'lockerFee'],
  [/daiquiri|beer|corona|miller|michelob|bud light|abita|coors|modelo|truly|twisted tea|margarita|absolut|seltzer|wine|mimosa|bucket of/i, 'alcohol'],
  [/water|soda|coke|coca|sprite|dr\.? ?pepper|lemonade|powerade|gatorade|drink|tea\b|icee|slush|coffee|cup refill|refill/i, 'nonalc'],
  [/pizza|burger|fries|tender|nacho|pretzel|hot dog|funnel|ice cream|melts|cookie|chips|candy|popcorn|wings|wrap|salad|sandwich|meal|snack|voucher|combo|churro|dippin|brownie|cheese|twizzler|mentos|gummy|platter|food/i, 'food'],
  [/phone|case|pouch|cup|sunglass|goggle|towel|bag|shirt|hat|apparel|sandal|shoe|sunscreen|toy|souvenir|jewelry|float|swim|clearance|retail/i, 'retail'],
  [/cabana|clam ?shell|fish camp|sundeck|pier house|boat house|hangout|covered area|parking|fee|rental/i, 'otherInPark'],
];

// Gift shop groups that override the inherited 2025 mapping (misspelled jewelry, charms)
export const RGROUP_OVERRIDE = { 'Jewerly $9': 'Toys & novelties', 'Jewerly $3': 'Toys & novelties', 'White Bracelet': 'Toys & novelties', 'Croc Charm': 'Toys & novelties' };

// 2024: before season pass scans began (Jul 5), passholders were admitted on a $0 General Admission Rate
// with a 100% coupon at the gate (12K+ in 2024 vs 174 in all of 2025). Counted as season pass visits.
export const isPassCoupon = l => /general admission rate$/i.test(norm(l.n)) && l.st === 0 && l.cp > 0 && Math.abs(l.cp - l.pr * l.q) < 0.01;

export const ACATS = ['Daiquiri', 'Beer', 'Seltzer & hard tea', 'Cocktail'];
export const acat = n => /daiquiri/i.test(n) ? 'Daiquiri' : /truly|twisted tea|seltzer/i.test(n) ? 'Seltzer & hard tea' : /margarita|absolut|cocktail|mimosa/i.test(n) ? 'Cocktail' : 'Beer';

export const rgroupRule = n => /phone|pouch|case/i.test(n) ? 'Phone cases & pouches' : /cup/i.test(n) ? 'Souvenir cups' : /sunglass|eyewear|glasses/i.test(n) ? 'Sunglasses & eyewear'
  : /goggle|swim|float|mask|snorkel/i.test(n) ? 'Goggles & swim gear' : /towel|bag|tote|backpack/i.test(n) ? 'Towels & bags' : /shirt|tee|hat|cap|hood|short|sandal|shoe|flip|apparel|sock|dress|tank|set|visor|croc/i.test(n) ? 'Apparel & footwear'
  : /sunscreen|spf|lotion|aloe|chapstick|lip|sanit/i.test(n) ? 'Sunscreen & personal care' : /toy|ball|jewel|keychain|magnet|plush|squirt|novelty|bracelet|charm/i.test(n) ? 'Toys & novelties' : 'Clearance & other';

// Rentals: one Rate line = one unit-day. The unit is the rate name (2025: one "Cabanas and Pavilions" event)
// or the event itself (2024: an event per unit, the rate being a shared template).
export const CABRX = /cabana|clam ?shell|fish camp|sundeck|pier house|boat house|hangout|covered area|riverview/i;
export const unitName = l => { const ev = norm(l.e); return CABRX.test(ev) && !/cabanas and pavilions/i.test(ev) ? ev : norm(l.n); };
export const unitTypeRule = n => /clam ?shell/i.test(n) ? 'Clamshell' : /fish camp/i.test(n) ? 'Fish camp' : /sundeck/i.test(n) ? 'Sundeck' : /pier house|boat house|hangout|covered area/i.test(n) ? 'Venue' : 'Cabana';
