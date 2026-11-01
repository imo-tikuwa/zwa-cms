import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Media = {
  id: number;
  r2_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  created_at: string;
};

export const listMedia = () => invoke<Media[]>("media_list");

export const uploadMedia = async (file: File) =>
  invoke<Media>("media_upload", new Uint8Array(await file.arrayBuffer()), {
    headers: {
      "x-filename": encodeURIComponent(file.name),
      // Tauri's IPC overwrites Content-Type on raw bodies.
      "x-mime-type": file.type,
    },
  });

export const updateMedia = (id: number, altText: string | null, caption: string | null) =>
  invoke<void>("media_update", { id, altText, caption });

export const deleteMedia = (id: number) => invoke<void>("media_delete", { id });

/** URL the published site uses for the file. Stored in post bodies. */
export const publicPath = (m: Media) => `/${m.r2_key}`;

/** URL the app's webview can load (served by the zwa-media protocol). */
export const previewUrl = (keyOrPath: string) =>
  convertFileSrc(keyOrPath.replace(/^\//, ""), "zwa-media");

/** Maps a src found in a post body to something the webview can show. */
export const displaySrc = (src: string) => (src.startsWith("/media/") ? previewUrl(src) : src);

export const isImage = (m: Media) => m.mime_type.startsWith("image/");

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
