//! GullyScore (Rust) — app library and Android entry point.
//!
//! The engine underneath (`gullyscore_engine`) is the full port of the
//! TypeScript engines, proved case-by-case against the originals by the
//! rust-anything-lab Record → Port → Check loop (1124/1124 recorded cases).
//!
//! On Android this crate builds as a cdylib loaded by
//! `android.app.NativeActivity` (see android/AndroidManifest.xml in the lab);
//! the glue crate exports `ANativeActivity_onCreate` and calls our
//! `android_main` below.

pub mod state;
pub mod ui;

pub use state::{GullyApp, LiveMatch, Screen, SetupState, WicketInput};

#[cfg(target_os = "android")]
mod android {
    use super::ui;

    /// NativeActivity entry (android-activity glue calls this on a dedicated
    /// thread after `Activity.onCreate`).
    #[no_mangle]
    fn android_main(app: winit::platform::android::activity::AndroidApp) {
        let options = eframe::NativeOptions {
            android_app: Some(app),
            ..Default::default()
        };
        if let Err(e) = ui::run_with_options(options) {
            eprintln!("eframe error: {e:?}");
        }
    }
}
