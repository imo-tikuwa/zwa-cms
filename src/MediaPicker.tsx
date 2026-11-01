import { Modal } from "@mantine/core";
import { Media } from "./lib/media";
import { MediaLibrary } from "./MediaLibrary";

/** Modal media library that returns the chosen file. */
export function MediaPicker({ onPick, onClose }: { onPick: (m: Media) => void; onClose: () => void }) {
  return (
    <Modal opened onClose={onClose} size="80rem" withCloseButton={false} padding="lg" classNames={{ body: "media-picker" }}>
      <MediaLibrary onPick={onPick} onClose={onClose} />
    </Modal>
  );
}
