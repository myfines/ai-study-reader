fn main() {
    // Common Controls v6 is required by Tao/rfd's TaskDialogIndirect import.
    // Tauri normally embeds its manifest in app binaries only; unit test
    // executables need the same activation context to start on Windows.
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("Tauri build configuration failed");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-changed=windows.manifest");
        println!("cargo:rerun-if-changed=windows-manifest.rc");
        embed_resource::compile_for_everything("windows-manifest.rc", embed_resource::NONE)
            .manifest_required()
            .expect("Windows activation manifest could not be compiled");
    }
}
