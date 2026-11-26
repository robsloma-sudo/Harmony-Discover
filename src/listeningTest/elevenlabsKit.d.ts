// The app's Metro bundler does not read package "exports", so the listening test imports the
// ElevenLabs kit's own web entry file by path. Same API as the package itself.
declare module '@elevenlabs/client/dist/platform/web/index.js' {
  export * from '@elevenlabs/client';
}
