// Keep the console window from appearing behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    diagram_plus_desktop_lib::run()
}
