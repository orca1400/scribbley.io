// src/components/CoverPreview.tsx
import React from "react";

type Props = {
  /** Text, der leise unten eingeblendet wird (nur Deko). */
  prompt?: string;
  className?: string;
};

const CoverPreview: React.FC<Props> = ({ prompt, className }) => {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-md border",
        "bg-gradient-to-br from-gray-100 to-gray-200",
        "animate-pulse",
        className || "",
      ].join(" ")}
    >
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(circle at 30% 20%, rgba(0,0,0,.06), transparent 40%)",
        }}
      />
      {prompt && (
        <div className="absolute bottom-1 left-1 right-1 text-[10px] leading-tight text-gray-500/70 line-clamp-4">
          {prompt}
        </div>
      )}
    </div>
  );
};

export default CoverPreview;
