use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

const EVENT_SELECT_PET: &str = "deskling-select-pet";
const EVENT_TOGGLE_CLICK_THROUGH: &str = "deskling-toggle-click-through";
const EVENT_TOGGLE_ALWAYS_ON_TOP: &str = "deskling-toggle-always-on-top";

fn show_control_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("control") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn emit_to_frontends<T: serde::Serialize + Clone>(app: &tauri::AppHandle, event: &str, payload: T) {
    let _ = app.emit_to("pet", event, payload.clone());
    let _ = app.emit_to("control", event, payload);
}

fn install_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open_lab = MenuItem::with_id(app, "open-lab", "Open Pet Lab", true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, "toggle-pet", "Show / Hide Pet", true, None::<&str>)?;
    let mochi = MenuItem::with_id(app, "pet-mochi", "Use Mochi", true, None::<&str>)?;
    let bella = MenuItem::with_id(app, "pet-bella", "Use Bella", true, None::<&str>)?;
    let click_through = MenuItem::with_id(
        app,
        "click-through",
        "Toggle Click-through",
        true,
        None::<&str>,
    )?;
    let always_on_top = MenuItem::with_id(
        app,
        "always-on-top",
        "Toggle Always on Top",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Deskling", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open_lab,
            &toggle_pet,
            &separator,
            &mochi,
            &bella,
            &click_through,
            &always_on_top,
            &separator_two,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("deskling-tray")
        .icon(
            app.default_window_icon()
                .expect("Deskling app icon is missing")
                .clone(),
        )
        .tooltip("Deskling")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open-lab" => show_control_window(app),
            "toggle-pet" => {
                if let Some(window) = app.get_webview_window("pet") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                    }
                }
            }
            "pet-mochi" => emit_to_frontends(app, EVENT_SELECT_PET, "mochi"),
            "pet-bella" => emit_to_frontends(app, EVENT_SELECT_PET, "bella"),
            "click-through" => emit_to_frontends(app, EVENT_TOGGLE_CLICK_THROUGH, ()),
            "always-on-top" => emit_to_frontends(app, EVENT_TOGGLE_ALWAYS_ON_TOP, ()),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Some(control) = app.get_webview_window("control") {
                let control_to_hide = control.clone();
                control.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = control_to_hide.hide();
                    }
                });
            }

            install_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Deskling");
}
