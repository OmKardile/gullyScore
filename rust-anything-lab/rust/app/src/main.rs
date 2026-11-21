//! Desktop entry (the Android entry lives in lib.rs — this crate is a cdylib
//! there). The sandbox has no display; this binary exists for completeness.

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_min_inner_size([380.0, 680.0])
            .with_inner_size([420.0, 860.0]),
        ..Default::default()
    };
    gullyscore_app::ui::run_with_options(options)
}
