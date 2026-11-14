import { CLASS_LABEL } from "@/landing/lib/class-labels";
// Static diagram (first design). Node names and classes follow the prototype's mock data; they are an
// illustration, not a live classification. Colors are for a dark section.
const TARGETS = [
  { y: 40, name: "vault.testnet", cls: "immutable_verified" as const, pass: true },
  { y: 140, name: "dex.testnet", cls: "local_upgradeable" as const, pass: true },
  { y: 240, name: "router.testnet", cls: "global_by_account" as const, pass: true },
  { y: 340, name: "bridge.testnet", cls: "unknown" as const, pass: false },
] as const;

const METERS = [
  { label: "slippage", fill: 0.24 },
  { label: "daily cap", fill: 0.62 },
  { label: "mutability", fill: 0.4 },
] as const;

const BEND = [900, 960, 990, 930];
const GATE = { x: 600, y: 190, w: 230, h: 220 };
const T_X = 1030;
const T_W = 300;
const T_H = 72;

export function VaultStage() {
  return (
    <svg
      viewBox="0 0 1440 600"
      role="img"
      aria-label="An owner writes the policy. An agent key that holds no funds sends every call through the vault. The vault passes calls to vault.testnet, dex.testnet and router.testnet, and refuses bridge.testnet because its risk is unknown. The passing targets are backed by a coverage pool."
      className="block h-auto w-full font-mono"
    >
      <g fill="none" stroke="#ffffff">
        {/* owner -> vault: policy */}
        <path d="M140 150 V100 H715 V190" strokeDasharray="4 4" strokeWidth="1" />
        {/* agent -> vault */}
        <path d="M420 300 H600" strokeWidth="1.5" />
        <path d="M590 294 L600 300 L590 306" strokeWidth="1.5" />
        {/* vault -> targets, vertical runs offset so lines never cross */}
        {TARGETS.map((t, i) => {
          const ty = t.y + T_H / 2;
          const y1 = 240 + i * 40;
          const x = BEND[i];
          return t.pass ? (
            <path key={t.name} d={`M${GATE.x + GATE.w} ${y1} H${x} V${ty} H${T_X}`} strokeWidth="1" />
          ) : (
            <path key={t.name} d={`M${GATE.x + GATE.w} ${y1} H${x} V${ty} H${T_X - 36}`} stroke="#ff7756" strokeWidth="1.5" strokeDasharray="1 4" strokeLinecap="round" />
          );
        })}
        {/* refusal mark */}
        <path d={`M${T_X - 30} ${340 + T_H / 2 - 8} l16 16 m0 -16 l-16 16`} stroke="#ff7756" strokeWidth="2" />
        {/* coverage bracket on the right: passing targets are backed by the pool */}
        <path d={`M${T_X + T_W} 76 h20 V520 H${T_X + T_W} M${T_X + T_W} 176 h20 M${T_X + T_W} 276 h20`} strokeWidth="1" />
      </g>

      {/* owner */}
      <rect x="40" y="150" width="200" height="100" fill="#141414" stroke="#ffffff" />
      <text x="140" y="196" textAnchor="middle" fontSize="16" fontWeight="500" fill="#ffffff">budi.testnet</text>
      <text x="140" y="222" textAnchor="middle" fontSize="13" fill="#bdbdbd">client, owner</text>

      {/* agent key */}
      <rect x="250" y="260" width="170" height="80" fill="#141414" stroke="#ffffff" strokeDasharray="4 4" />
      <text x="335" y="296" textAnchor="middle" fontSize="15" fontWeight="500" fill="#ffffff">yield-agent key</text>
      <text x="335" y="320" textAnchor="middle" fontSize="13" fill="#bdbdbd">function-call key</text>

      {/* vault gate */}
      <rect x={GATE.x} y={GATE.y} width={GATE.w} height={GATE.h} fill="#141414" stroke="#ffffff" strokeWidth="2" />
      <text x={GATE.x + GATE.w / 2} y="226" textAnchor="middle" fontSize="18" fontWeight="500" fill="#ffffff">vault</text>
      <text x={GATE.x + GATE.w / 2} y="248" textAnchor="middle" fontSize="12" fill="#bdbdbd">vault-budi.aruna.testnet</text>
      {METERS.map((m, i) => {
        const y = 292 + i * 40;
        return (
          <g key={m.label}>
            <text x={GATE.x + 24} y={y - 6} fontSize="12" fill="#bdbdbd">{m.label}</text>
            <rect x={GATE.x + 24} y={y} width={GATE.w - 48} height="4" fill="#3e3e3e" />
            <rect x={GATE.x + 24} y={y} width={(GATE.w - 48) * m.fill} height="4" fill="#ffffff" />
          </g>
        );
      })}

      {/* targets */}
      {TARGETS.map((t) => (
        <g key={t.name}>
          <rect
            x={T_X}
            y={t.y}
            width={T_W}
            height={T_H}
            fill="#141414"
            stroke={t.pass ? "#ffffff" : "#9a9a9a"}
            strokeDasharray={t.pass ? undefined : "1 3"}
            strokeLinecap="round"
          />
          <text x={T_X + 16} y={t.y + 30} fontSize="15" fontWeight="500" fill="#ffffff">{t.name}</text>
          <text x={T_X + 16} y={t.y + 54} fontSize="12" fill={t.pass ? "#bdbdbd" : "#ff7756"}>
            {t.pass ? CLASS_LABEL[t.cls] : `${CLASS_LABEL[t.cls]}: refused`}
          </text>
        </g>
      ))}

      {/* coverage pool */}
      <rect x={T_X} y="480" width={T_W} height="80" fill="#1e1e1e" stroke="#ffffff" />
      <text x={T_X + 16} y="514" fontSize="15" fontWeight="500" fill="#ffffff">coverage pool</text>
      <text x={T_X + 16} y="538" fontSize="12" fill="#bdbdbd">underwriter capital</text>
    </svg>
  );
}
