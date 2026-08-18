import React from 'react';
import { Tag } from 'lucide-react';
import SelectFilter from './SelectFilter';

// SQEM-071 — shared tag-filter dropdown used by Templates and Files.
// Presentational + controlled; `tags` is the workspace tag vocabulary
// (see lib/workspaceTags.ts). Selecting the "all" option passes null.
// SQEM-254 — the dropdown itself now lives in `SelectFilter`, so the "used in" filter beside this
// one cannot drift away from it. The props here are unchanged; call sites did not move.

export default function TagFilter({
  tags,
  value,
  onChange,
  allLabel = 'All Tags',
}: {
  tags: string[];
  value: string | null;
  onChange: (tag: string | null) => void;
  allLabel?: string;
}) {
  return (
    <SelectFilter
      icon={Tag}
      ariaLabel="Filter by tag"
      allLabel={allLabel}
      options={tags.map(tag => ({ value: tag, label: tag }))}
      value={value}
      onChange={onChange}
    />
  );
}
