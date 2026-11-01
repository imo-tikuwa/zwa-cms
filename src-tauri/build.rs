use std::fmt::Write;
use std::path::Path;

fn main() {
    embed_migrations();
    tauri_build::build()
}

/// Embeds `../migrations/*.sql` (sorted by name) so new migration files are
/// picked up without code changes.
fn embed_migrations() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let dir = Path::new(&manifest_dir).join("..").join("migrations");
    println!("cargo:rerun-if-changed={}", dir.display());
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("migrations directory")
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".sql"))
        .collect();
    names.sort();
    let mut out = String::from("pub const MIGRATIONS: &[(&str, &str)] = &[\n");
    for name in names {
        assert!(
            name.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.'),
            "unexpected migration file name: {name}"
        );
        let path = dir.join(&name);
        println!("cargo:rerun-if-changed={}", path.display());
        writeln!(out, "    ({name:?}, include_str!({:?})),", path.display()).unwrap();
    }
    out.push_str("];\n");
    let out_path = Path::new(&std::env::var("OUT_DIR").unwrap()).join("migrations.rs");
    std::fs::write(out_path, out).unwrap();
}
