"use client";

import { useId, useRef } from "react";

export function FilePicker({
  accept,
  label,
  help,
  onFiles,
  disabled = false,
  multiple = true,
}: {
  accept: string;
  label: string;
  help: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const helpId = useId();
  return (
    <div
      className="file-picker"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) {
          const files = Array.from(event.dataTransfer.files);
          onFiles(multiple ? files : files.slice(0, 1));
        }
      }}
    >
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        aria-label={label}
        hidden
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          onFiles(multiple ? files : files.slice(0, 1));
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="quiet-button"
        disabled={disabled}
        aria-describedby={helpId}
        onClick={() => input.current?.click()}
      >
        {label}
      </button>
      <p id={helpId} className="small-copy">
        {help}
      </p>
    </div>
  );
}
