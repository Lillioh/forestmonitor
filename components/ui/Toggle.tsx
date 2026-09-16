export default function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      {label && <span className="text-[11px] text-gray-300">{label}</span>}
      <span
        className={`relative h-5 w-9 rounded-full transition ${
          checked ? "bg-[#62b66d]" : "bg-[#2a3830]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
