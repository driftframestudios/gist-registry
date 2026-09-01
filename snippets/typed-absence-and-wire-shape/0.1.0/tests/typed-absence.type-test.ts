import {
  projectRoutePatch,
  type RoutePatch,
  type RoutePatchWire,
} from "../src/typed-absence.js";

const omitted: RoutePatch = {};
const explicitClear: RoutePatch = { fallbackRoute: null };
const presentEmpty: RoutePatch = { headers: {} };
const meaningfulFalsy: RoutePatch = {
  retryLimit: 0,
  enabled: false,
  displayLabel: "",
};
const projected: RoutePatchWire = projectRoutePatch({
  ...explicitClear,
  ...presentEmpty,
  ...meaningfulFalsy,
});

void [omitted, projected];

// @ts-expect-error exact optional properties distinguish omission from present undefined.
const explicitUndefined: RoutePatch = { summary: undefined };
// @ts-expect-error null is admitted only by fallbackRoute's presence meaning.
const misplacedNull: RoutePatch = { summary: null };
// @ts-expect-error the projected wire shape is read-only.
projected.enabled = true;

void [explicitUndefined, misplacedNull];
