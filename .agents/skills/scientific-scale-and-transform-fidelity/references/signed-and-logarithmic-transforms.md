# Signed and logarithmic transformations

Load when wide dynamic range or nonpositive values change the reading. A scale
choice starts from the quantity and task, then names the function and parameters.

| Candidate | Supported reading | Consequential choice |
| --- | --- | --- |
| Linear | Additive distance across the admitted values | Small variation may need a detail panel. |
| Log, base b > 1 | Ratios among positive values | Zero and negative values need a separate declared representation. |
| Offset log `log_b(x+c)` | A specifically defined transformed quantity | c has the input's unit; low-value ratios change with c. |
| Symlog | Signed data with a central linear region and logarithmic tails | Base, threshold, and linear-region visual width are part of the contract. |
| Asinh | Signed data with a smooth central-to-tail transition | Cofactor/linear-width and numerical convention determine meaning. |

Facets, an aligned detail panel, or a table remain useful alternatives when a
nonlinear map increases the interpretation burden. A domain method such as
logicle can be the proper receiver for compensated fluorescence; the method's
name, implementation and parameters carry its own evidence.

## Three distinct mappings

1. An analysis transformation produces new values, e.g. `z=asinh(x/c)`.
2. An axis transform places raw values using a mapping, while ticks can remain
   labeled with x in the original unit.
3. A color normalization maps a quantity to a color coordinate; its legend
   describes that quantity and domain.

Applying a logarithmic axis to already logged data creates a second transform.
That may be intentional, but it is a different quantity/geometry that needs an
explicit reason and labels. A sample table records raw, derived, and displayed
values separately when multiple stages are material.

For asinh, `asinh(x/c)` is dimensionless. Matplotlib 3.11.2 documents the axis
mapping `c*asinh(x/c)` with `c=linear_width`; its `base` controls tick rounding.
At a fixed c these geometries differ by a constant multiplier, but their exported
transformed numbers and cross-panel domains differ. Keep a normalized-axis
similarity claim separate from a numerical identity claim. The API is marked
provisional; an adapter binds to its installed version.

Symlog is a family of piecewise mappings. Matplotlib exposes `linthresh`,
`linscale`, and `base`; another implementation's similarly named scale can use a
different parameterization. The exercise uses a fully stated teaching function:

```text
f(x) = x/t                                  when |x| <= t
f(x) = sign(x) * (1 + log_b(|x|/t))          otherwise
f_inverse(y) = t*y                           when |y| <= 1
f_inverse(y) = sign(y) * t*b**(|y|-1)        otherwise
```

It uses `t=1`, `b=10` in its exported illustration. It is an authored,
unit-central-width symlog example, not an adapter for Matplotlib's linscale.
The function is continuous and monotone; generally its gradient changes at the
transition. Its raw-unit tick labels make the finite example interpretable.

## Prove the receiving map

Use independently calculated anchors such as `log10(1)=0`, `log10(10)=1`,
`asinh(0)=0`, and the exact threshold. Test negative/zero/positive values where
admitted; monotonicity; forward/inverse tolerance; and the parameter that can
change the conclusion. Include the unit/rescaling case: converting input units
requires converting a cofactor/offset/threshold in those units as well.

Keep finite-domain and overflow policy explicit. A general-purpose plotting
library should provide stable numerical primitives; a small exercise establishes
only its named finite input range. Rendering, scientific parameter justification,
and audience interpretation receive their own proof.
