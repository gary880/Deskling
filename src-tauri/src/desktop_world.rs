use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowSnapshot {
    pub app_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub bounds: Rect,
    pub minimized: bool,
    pub monitor_id: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // `Unsupported` is used by the non-macOS provider.
pub enum AccessibilityPermissionStatus {
    Authorized,
    Denied,
    Unsupported,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{AccessibilityPermissionStatus, DesktopWindowSnapshot, Rect};
    use std::{ffi::c_void, os::raw::c_char, ptr};

    type AXError = i32;
    type AXUIElementRef = *const c_void;
    type AXValueRef = *const c_void;
    type CFBooleanRef = *const c_void;
    type CFDictionaryRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFTypeRef = *const c_void;
    type CGDirectDisplayID = u32;
    type ObjcId = *mut c_void;
    type ObjcSelector = *const c_void;

    const AX_SUCCESS: AXError = 0;
    const AX_VALUE_CG_POINT: i32 = 1;
    const AX_VALUE_CG_SIZE: i32 = 2;
    const CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const MAX_DISPLAYS: usize = 32;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGSize {
        width: f64,
        height: f64,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct CGRect {
        origin: CGPoint,
        size: CGSize,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;

        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> AXError;
        fn AXValueGetValue(value: AXValueRef, value_type: i32, output: *mut c_void) -> bool;

        fn CGGetActiveDisplayList(
            max_displays: u32,
            active_displays: *mut CGDirectDisplayID,
            display_count: *mut u32,
        ) -> i32;
        fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
        fn CGMainDisplayID() -> CGDirectDisplayID;
    }

    #[link(name = "objc")]
    extern "C" {
        fn sel_registerName(name: *const c_char) -> ObjcSelector;
        fn objc_msgSend();
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: CFBooleanRef;
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            value: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFBooleanGetValue(boolean: CFBooleanRef) -> bool;
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFRelease(value: CFTypeRef);
    }

    struct OwnedCF(CFTypeRef);

    impl OwnedCF {
        fn as_ptr(&self) -> CFTypeRef {
            self.0
        }
    }

    impl Drop for OwnedCF {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) };
            }
        }
    }

    unsafe fn attribute(element: AXUIElementRef, name: &'static [u8]) -> Option<OwnedCF> {
        debug_assert_eq!(name.last(), Some(&0));
        let name = OwnedCF(CFStringCreateWithCString(
            ptr::null(),
            name.as_ptr() as *const c_char,
            CF_STRING_ENCODING_UTF8,
        ));
        if name.as_ptr().is_null() {
            return None;
        }
        let mut value = ptr::null();
        if AXUIElementCopyAttributeValue(element, name.as_ptr() as CFStringRef, &mut value)
            == AX_SUCCESS
            && !value.is_null()
        {
            Some(OwnedCF(value))
        } else {
            None
        }
    }

    unsafe fn ax_point(value: CFTypeRef) -> Option<CGPoint> {
        let mut point = CGPoint::default();
        AXValueGetValue(
            value as AXValueRef,
            AX_VALUE_CG_POINT,
            &mut point as *mut CGPoint as *mut c_void,
        )
        .then_some(point)
    }

    unsafe fn ax_size(value: CFTypeRef) -> Option<CGSize> {
        let mut size = CGSize::default();
        AXValueGetValue(
            value as AXValueRef,
            AX_VALUE_CG_SIZE,
            &mut size as *mut CGSize as *mut c_void,
        )
        .then_some(size)
    }

    fn overlap_area(a: Rect, b: Rect) -> f64 {
        let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
        let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
        width.max(0.0) * height.max(0.0)
    }

    fn monitor_id(bounds: Rect) -> String {
        unsafe {
            let mut displays = [0_u32; MAX_DISPLAYS];
            let mut count = 0_u32;
            if CGGetActiveDisplayList(MAX_DISPLAYS as u32, displays.as_mut_ptr(), &mut count) != 0 {
                return "unknown".into();
            }

            displays[..count as usize]
                .iter()
                .copied()
                .map(|id| {
                    let display = CGDisplayBounds(id);
                    let display_bounds = Rect {
                        x: display.origin.x,
                        y: display.origin.y,
                        width: display.size.width,
                        height: display.size.height,
                    };
                    (id, overlap_area(bounds, display_bounds))
                })
                .max_by(|left, right| left.1.total_cmp(&right.1))
                .filter(|(_, area)| *area > 0.0)
                .map(|(id, _)| id.to_string())
                .unwrap_or_else(|| "unknown".into())
        }
    }

    pub fn permission_status() -> AccessibilityPermissionStatus {
        if unsafe { AXIsProcessTrusted() } {
            AccessibilityPermissionStatus::Authorized
        } else {
            AccessibilityPermissionStatus::Denied
        }
    }

    pub fn request_permission() -> AccessibilityPermissionStatus {
        unsafe {
            let key = kAXTrustedCheckOptionPrompt as *const c_void;
            let value = kCFBooleanTrue as *const c_void;
            let options =
                CFDictionaryCreate(ptr::null(), &key, &value, 1, ptr::null(), ptr::null());
            if !options.is_null() {
                let trusted = AXIsProcessTrustedWithOptions(options);
                CFRelease(options);
                if trusted {
                    return AccessibilityPermissionStatus::Authorized;
                }
            }
        }
        AccessibilityPermissionStatus::Denied
    }

    pub fn active_window() -> Option<DesktopWindowSnapshot> {
        if !matches!(
            permission_status(),
            AccessibilityPermissionStatus::Authorized
        ) {
            return None;
        }

        unsafe {
            let system = OwnedCF(AXUIElementCreateSystemWide() as CFTypeRef);
            let app = attribute(system.as_ptr(), b"AXFocusedApplication\0")?;

            let mut pid = 0_i32;
            if AXUIElementGetPid(app.as_ptr() as AXUIElementRef, &mut pid) != AX_SUCCESS
                || pid == std::process::id() as i32
            {
                return None;
            }

            let window = attribute(app.as_ptr() as AXUIElementRef, b"AXFocusedWindow\0")?;
            let position = attribute(window.as_ptr() as AXUIElementRef, b"AXPosition\0")
                .and_then(|value| ax_point(value.as_ptr()))?;
            let size = attribute(window.as_ptr() as AXUIElementRef, b"AXSize\0")
                .and_then(|value| ax_size(value.as_ptr()))?;
            let minimized = attribute(window.as_ptr() as AXUIElementRef, b"AXMinimized\0")
                .map(|value| CFBooleanGetValue(value.as_ptr() as CFBooleanRef))
                .unwrap_or(false);
            let bounds = Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };

            (bounds.width > 0.0 && bounds.height > 0.0).then(|| DesktopWindowSnapshot {
                // The PID is deliberately used as an opaque application identifier. This
                // avoids reading app/window content and is sufficient for change detection.
                app_id: format!("pid:{pid}"),
                title: None,
                bounds,
                minimized,
                monitor_id: monitor_id(bounds),
            })
        }
    }

    pub unsafe fn set_window_top_left(ns_window: usize, x: f64, y: f64) {
        type SetFrameTopLeftPoint = unsafe extern "C" fn(ObjcId, ObjcSelector, CGPoint);

        let main_bounds = CGDisplayBounds(CGMainDisplayID());
        let cocoa_point = CGPoint {
            x,
            y: main_bounds.origin.y + main_bounds.size.height - y,
        };
        let selector = sel_registerName(b"setFrameTopLeftPoint:\0".as_ptr() as *const c_char);
        let send: SetFrameTopLeftPoint = std::mem::transmute(objc_msgSend as *const ());
        send(ns_window as ObjcId, selector, cocoa_point);
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{AccessibilityPermissionStatus, DesktopWindowSnapshot};

    pub fn permission_status() -> AccessibilityPermissionStatus {
        AccessibilityPermissionStatus::Unsupported
    }

    pub fn request_permission() -> AccessibilityPermissionStatus {
        AccessibilityPermissionStatus::Unsupported
    }

    pub fn active_window() -> Option<DesktopWindowSnapshot> {
        None
    }

    pub unsafe fn set_window_top_left(_ns_window: usize, _x: f64, _y: f64) {}
}

pub use platform::{active_window, permission_status, request_permission, set_window_top_left};

pub fn open_accessibility_settings() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
