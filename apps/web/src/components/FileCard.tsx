import { fileLinks } from "../transcript.ts";

const ICONS: [RegExp, string][] = [
  [/\.(png|jpe?g|gif|webp|heic)$/i, "🖼"],
  [/\.(mp4|mov|mkv|webm)$/i, "🎬"],
  [/\.(mp3|m4a|wav|flac)$/i, "🎵"],
  [/\.(zip|tar|gz|7z|rar)$/i, "🗜"],
  [/\.pdf$/i, "📕"],
  [/\.(docx?|pages|txt|md|rtf)$/i, "📄"],
  [/\.(xlsx?|csv|numbers)$/i, "📊"],
  [/\.(pptx?|key)$/i, "📽"],
];
const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? "📦";

/** Download cards for every /files/<token>/<name> link in a piece of text. */
export function FileCards({ text, exclude }: { text?: string; exclude?: Set<string> }) {
  const files = fileLinks(text).filter((f) => !exclude?.has(f.url));
  if (!files.length) return null;
  return (
    <div className="file-cards">
      {files.map((f) => (
        <a key={f.url} className="file-card" href={f.url} download={f.name}>
          <span className="file-icon">{iconFor(f.name)}</span>
          <span className="file-name">{f.name}</span>
          <span className="file-dl">⬇</span>
        </a>
      ))}
    </div>
  );
}
