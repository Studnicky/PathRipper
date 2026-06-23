// Parsed spell statblock fields lifted from `table.monstats`.
//
// Single-purpose type module: kept separate from `common.ts` so each parser
// module declares exactly one data shape.

/** Parsed spell statblock fields lifted from `table.monstats`. */
export type SpellTable = {
  level:         number | null;
  school:        string | null;
  casting_time:  string | null;
  range:         string | null;
  components:    string | null;
  duration:      string | null;
  higher_levels: string | null;
};
