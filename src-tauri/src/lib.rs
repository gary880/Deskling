use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

mod desktop_world;
mod pet_packages;

const EVENT_SELECT_PET: &str = "deskling-select-pet";
const EVENT_TOGGLE_CLICK_THROUGH: &str = "deskling-toggle-click-through";
const EVENT_TOGGLE_ALWAYS_ON_TOP: &str = "deskling-toggle-always-on-top";
const EVENT_TOGGLE_WINDOW_AWARE: &str = "deskling-toggle-window-aware";
const EVENT_TOGGLE_FOLLOW_ACTIVE_WINDOW: &str = "deskling-toggle-follow-active-window";
const EVENT_TOGGLE_DESKTOP_FLOOR_FALLBACK: &str = "deskling-toggle-desktop-floor-fallback";
const EVENT_ACCESSIBILITY_STATUS_CHANGED: &str = "deskling-accessibility-status-changed";

#[tauri::command]
fn accessibility_permission_status() -> desktop_world::AccessibilityPermissionStatus {
    desktop_world::permission_status()
}

#[tauri::command]
fn request_accessibility_permission() -> desktop_world::AccessibilityPermissionStatus {
    desktop_world::request_permission()
}

#[tauri::command]
fn open_accessibility_settings() -> bool {
    desktop_world::open_accessibility_settings()
}

#[tauri::command]
async fn active_desktop_window() -> Option<desktop_world::DesktopWindowSnapshot> {
    tauri::async_runtime::spawn_blocking(desktop_world::active_window)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
fn position_pet_window(window: tauri::WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                desktop_world::set_window_top_left(ns_window, x, y);
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
async fn import_pet_zip(
    app: tauri::AppHandle,
    zip_path: String,
    replace: bool,
) -> Result<pet_packages::InstalledPet, String> {
    tauri::async_runtime::spawn_blocking(move || {
        pet_packages::import_pet_zip(&app, std::path::Path::new(&zip_path), replace)
    })
    .await
    .map_err(|error| format!("Pet import task failed: {error}"))?
}

#[tauri::command]
fn list_installed_pets(app: tauri::AppHandle) -> Result<Vec<pet_packages::InstalledPet>, String> {
    pet_packages::list_installed_pets(&app)
}

#[tauri::command]
async fn remove_installed_pet(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || pet_packages::remove_installed_pet(&app, &id))
        .await
        .map_err(|error| format!("Pet removal task failed: {error}"))?
}

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
    let window_aware = MenuItem::with_id(
        app,
        "window-aware",
        "Toggle Window-aware Mode",
        true,
        None::<&str>,
    )?;
    let follow_active_window = MenuItem::with_id(
        app,
        "follow-active-window",
        "Toggle Follow Active Window",
        true,
        None::<&str>,
    )?;
    let desktop_floor_fallback = MenuItem::with_id(
        app,
        "desktop-floor-fallback",
        "Toggle Desktop Floor Fallback",
        true,
        None::<&str>,
    )?;
    let permission_label = match desktop_world::permission_status() {
        desktop_world::AccessibilityPermissionStatus::Authorized => "Accessibility: Authorized",
        desktop_world::AccessibilityPermissionStatus::Denied => "Accessibility: Needs Permission…",
        desktop_world::AccessibilityPermissionStatus::Unsupported => "Accessibility: Unsupported",
    };
    let accessibility = MenuItem::with_id(
        app,
        "accessibility-permission",
        permission_label,
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;
    let separator_three = PredefinedMenuItem::separator(app)?;
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
            &window_aware,
            &follow_active_window,
            &desktop_floor_fallback,
            &accessibility,
            &separator_three,
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
            "window-aware" => emit_to_frontends(app, EVENT_TOGGLE_WINDOW_AWARE, ()),
            "follow-active-window" => emit_to_frontends(app, EVENT_TOGGLE_FOLLOW_ACTIVE_WINDOW, ()),
            "desktop-floor-fallback" => {
                emit_to_frontends(app, EVENT_TOGGLE_DESKTOP_FLOOR_FALLBACK, ())
            }
            "accessibility-permission" => {
                let status = desktop_world::request_permission();
                if matches!(status, desktop_world::AccessibilityPermissionStatus::Denied) {
                    let _ = desktop_world::open_accessibility_settings();
                }
                emit_to_frontends(app, EVENT_ACCESSIBILITY_STATUS_CHANGED, status);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            accessibility_permission_status,
            request_accessibility_permission,
            open_accessibility_settings,
            active_desktop_window,
            position_pet_window,
            import_pet_zip,
            list_installed_pets,
            remove_installed_pet
        ])
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
