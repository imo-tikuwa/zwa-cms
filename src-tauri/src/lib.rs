mod ai;
mod auth;
mod cloudflare;
mod credential;
mod db;
mod error;
mod forms;
mod github;
mod images;
mod lock;
mod media;
mod migrations;
mod posts;
mod publish;
mod redirects;
mod settings;
mod site_settings;
mod sitebuild;
mod sites;
mod taxonomy;
mod theme;
mod tray;

use log::LevelFilter;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Before single-instance, so a second launch that exits early is logged too.
        // Writes to the terminal and to the app's log dir (on Windows
        // %LOCALAPPDATA%\<identifier>\logs).
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { LevelFilter::Debug } else { LevelFilter::Info })
                // Connection internals drown out the app's own lines at debug level.
                .level_for("hyper_util", LevelFilter::Info)
                .level_for("keyring", LevelFilter::Info)
                .level_for("reqwest", LevelFilter::Info)
                .level_for("rustls", LevelFilter::Info)
                .level_for("tao", LevelFilter::Info)
                .level_for("wry", LevelFilter::Info)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        // Otherwise first: a second launch just brings this one forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("another launch; showing this window instead");
            tray::show_main(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            log::info!(
                "zwa-cms {} starting; logs in {}",
                app.package_info().version,
                app.path().app_log_dir().map(|p| p.display().to_string()).unwrap_or_default(),
            );
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!("panic: {info}\n{}", std::backtrace::Backtrace::force_capture());
                default_hook(info);
            }));
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .manage(sitebuild::Preview::default())
        .manage(ai::Running::default())
        .manage(migrations::Checked::default())
        .register_asynchronous_uri_scheme_protocol(media::SCHEME, media::protocol)
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            github::github_status,
            github::github_check_token,
            github::github_link,
            github::github_unlink,
            auth::auth_sign_in_with_token,
            auth::auth_select_account,
            auth::auth_sign_out,
            sites::sites_state,
            sites::site_select,
            sites::site_forget,
            sites::site_delete,
            sites::site_create,
            sites::site_connect_candidates,
            sites::site_connect,
            posts::posts_list,
            posts::post_get,
            posts::post_save,
            posts::post_delete,
            taxonomy::categories_list,
            taxonomy::category_save,
            taxonomy::category_delete,
            taxonomy::tags_list,
            taxonomy::tag_save,
            taxonomy::tag_delete,
            taxonomy::authors_list,
            taxonomy::author_save,
            taxonomy::author_delete,
            forms::forms_status,
            forms::forms_enable,
            forms::forms_disable,
            forms::forms_list,
            forms::form_save,
            forms::form_delete,
            forms::submissions_list,
            forms::submission_set_read,
            forms::submission_delete,
            forms::submissions_poll,
            redirects::redirects_list,
            redirects::redirect_save,
            redirects::redirect_delete,
            media::media_list,
            media::media_upload,
            media::media_update,
            media::media_delete,
            site_settings::site_settings_get,
            site_settings::site_settings_save,
            site_settings::basic_auth_get,
            site_settings::basic_auth_set,
            site_settings::basic_auth_clear,
            publish::site_publish,
            publish::publish_status,
            ai::ai_status,
            ai::ai_set_default_model,
            ai::ai_set_key,
            ai::ai_delete_key,
            ai::ai_settings_get,
            ai::ai_settings_save,
            ai::ai_run,
            ai::ai_cancel,
            ai::ai_usage,
            migrations::site_migrate,
            tray::window_prefs_get,
            tray::window_prefs_set,
            tray::app_quit,
            tray::log_dir_open,
            lock::lock_status,
            lock::lock_enable,
            lock::lock_disable,
            lock::lock_unlock,
            lock::lock_now,
            lock::lock_set_minutes,
            lock::lock_reset,
            tray::play_sound,
            theme::theme_status,
            theme::theme_export_default,
            theme::theme_upload,
            theme::theme_reset,
            theme::theme_set_dev_dir,
            sitebuild::preview_build,
            sitebuild::preview_url,
            sitebuild::preview_set_appearance,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("failed to start: {e}");
            panic!("error while running tauri application: {e}");
        })
        .run(|_app, event| match event {
            RunEvent::ExitRequested { code, .. } => log::info!("exit requested (code {code:?})"),
            RunEvent::Exit => log::info!("exiting"),
            _ => {}
        });
}
