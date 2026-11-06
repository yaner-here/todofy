fn main() {
    println!("cargo:rerun-if-changed=../src/locales/en.json");
    println!("cargo:rerun-if-changed=../src/locales/zh-CN.json");
    tauri_build::build()
}
