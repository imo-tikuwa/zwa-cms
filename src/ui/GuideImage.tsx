import { useState } from "react";
import { Modal, Text, UnstyledButton } from "@mantine/core";
import { ZoomIn } from "lucide-react";

/** A screenshot of another site's page, small in place and full size on click. */
export function GuideImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <UnstyledButton className="guide-image" onClick={() => setOpen(true)} title="クリックで拡大">
        <img src={src} alt={alt} />
        <Text component="span" size="xs" c="dimmed" className="guide-image-hint">
          <ZoomIn size={12} /> クリックで拡大
        </Text>
      </UnstyledButton>
      <Modal opened={open} onClose={() => setOpen(false)} size="auto" title={alt} centered>
        <img src={src} alt={alt} className="guide-image-full" />
      </Modal>
    </>
  );
}
