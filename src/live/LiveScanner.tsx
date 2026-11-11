// The photo scanner runs in the web build (LiveScanner.web.tsx). The installed iPhone build keeps the
// existing capture flow until its own scanner lands, so this version draws nothing.
export default function LiveScanner(_props: { photos: string[]; onClose: () => void }) {
  return null;
}
