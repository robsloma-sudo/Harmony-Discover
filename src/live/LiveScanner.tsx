// The live scanner runs in the web build (LiveScanner.web.tsx). The installed iPhone build keeps the
// existing capture flow until its on-device scanner lands, so this version draws nothing.
export default function LiveScanner(_props: { onClose: () => void }) {
  return null;
}
