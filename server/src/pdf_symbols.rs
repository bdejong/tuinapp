//! Small monochrome vector symbols; coordinates use the SVG assets' 24-unit canvas.
use printpdf::{
    path::{PaintMode, WindingOrder},
    *,
};

pub(super) const SIZE: f32 = 2.2;
pub(super) const ADVANCE: f32 = 2.65;

pub(super) fn draw(layer: &PdfLayerReference, bit: i32, x: Mm, baseline: Mm) {
    let point = |px: f32, py: f32| {
        Point::new(
            Mm(x.0 + px * SIZE / 24.),
            Mm(baseline.0 + 1.6 - py * SIZE / 24.),
        )
    };
    layer.save_graphics_state();
    layer.set_outline_color(Color::Greyscale(Greyscale::new(0., None)));
    layer.set_fill_color(Color::Greyscale(Greyscale::new(1., None)));
    layer.set_outline_thickness(0.38);
    layer.set_line_cap_style(LineCapStyle::Round);
    layer.set_line_join_style(LineJoinStyle::Round);
    if bit != 4 {
        let (cx, cy, r, inner, outer) = if bit == 1 {
            (12., 12., 4.3, 6.7, 10.5)
        } else {
            (9., 8., 3.6, 5.6, 7.4)
        };
        let center = point(cx, cy);
        layer.add_line(Line {
            points: calculate_points_for_circle(
                Pt(r * SIZE / 24. * 72. / 25.4),
                center.x,
                center.y,
            ),
            is_closed: true,
        });
        for ray in 0..8 {
            let angle = ray as f32 * std::f32::consts::FRAC_PI_4;
            layer.add_line(Line {
                points: vec![
                    (
                        point(cx + inner * angle.cos(), cy + inner * angle.sin()),
                        false,
                    ),
                    (
                        point(cx + outer * angle.cos(), cy + outer * angle.sin()),
                        false,
                    ),
                ],
                is_closed: false,
            });
        }
    }
    if bit != 1 {
        let (scale, dx, dy) = if bit == 2 {
            (0.9, 1.5, 3.5)
        } else {
            (1., 0., 0.)
        };
        // A white-filled cloud masks the lower part of the half-sun, without grey shading.
        let coords = [
            (6., 19.),
            (1., 19.),
            (0.5, 12.),
            (5., 10.5),
            (5., 4.5),
            (14., 3.),
            (17.5, 9.),
            (24., 8.),
            (26., 19.),
            (19., 19.),
        ];
        let points = coords
            .into_iter()
            .map(|(px, py)| (point(dx + px * scale, dy + py * scale), true))
            .collect();
        layer.add_polygon(Polygon {
            rings: vec![points],
            mode: PaintMode::FillStroke,
            winding_order: WindingOrder::NonZero,
        });
    }
    layer.restore_graphics_state();
}

pub(super) fn legend(layer: &PdfLayerReference, font: &IndirectFontRef) {
    for (bit, label, x) in [
        (1, "Full sun", 75.),
        (2, "Half sun", 100.),
        (4, "Shade", 125.),
    ] {
        draw(layer, bit, Mm(x), Mm(290.));
        layer.use_text(label, 5.5, Mm(x + 3.), Mm(290.), font);
    }
    layer.use_text("[1] = plant note", 5.5, Mm(150.), Mm(290.), font);
}
