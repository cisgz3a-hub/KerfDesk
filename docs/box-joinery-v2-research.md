# Box Joinery V2 research and licensing notes

## Research summary

- Boxes.py models material thickness as a critical physical input and treats `burn`/kerf as the laser radius, or half of the cut width. Its docs explicitly warn that plywood thickness variation can make even 0.01 mm matter for joint stiffness.
- Inkscape BoxMaker / TabbedBoxMaker separates kerf from clearance. Kerf corrects the cutter width; clearance deliberately loosens the joint.
- OpenSCAD laser-box generators commonly model the object parametrically first, then output flattened panels. That is the design direction used by LaserForge V2: define panels and physical joints first, then render cut paths.
- Practical laser-cut box guidance consistently recommends measuring the exact sheet with calipers and burning a test coupon before a full box because kerf varies by material, focus, power, speed, and air assist.

## Licensing note

This V2 implementation does not copy Boxes.py, Inkscape BoxMaker, MakerCase, or OpenSCAD generator source code. It is a clean-room TypeScript implementation using general engineering principles:

1. build a panel model,
2. define physical joints explicitly,
3. generate both mating edges from one shared pattern,
4. keep kerf and clearance separate,
5. test physical post-cut contracts.

## Design decision

The previous LaserForge generator produced each face independently using edge modes such as `finger` and `slot`. V2 creates explicit `JointPattern` instances for physical pairs like `bottom-front` and derives both mating edge profiles from that shared pattern. This prevents parity drift and makes the fit testable.
