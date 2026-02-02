// core/formatter.ts
// Date, number, and currency formatting

// ============================================
// Formatter Registry
// ============================================

export type Formatter = (value: string) => string;

const formatters: Map<string, Formatter> = new Map();

/**
 * Register a formatter by name
 */
export function registerFormatter(name: string, fn: Formatter): void {
  formatters.set(name, fn);
}

/**
 * Get formatter by name
 */
export function getFormatter(name: string | undefined): Formatter {
  if (!name || name === 'raw') {
    return rawFormatter;
  }

  const formatter = formatters.get(name);
  if (formatter) {
    return formatter;
  }

  // Try built-in formatters
  switch (name) {
    case 'date':
      return dateFormatter;
    case 'number':
      return numberFormatter;
    case 'yen':
    case 'currency':
      return yenFormatter;
    default:
      return rawFormatter;
  }
}

// ============================================
// Built-in Formatters
// ============================================

/**
 * Raw formatter - returns value as-is
 */
export const rawFormatter: Formatter = (value: string) => value;

/**
 * Date formatter - formats ISO date (YYYY-MM-DD) to Japanese format
 */
export const dateFormatter: Formatter = (value: string) => {
  if (!value || value === '') return '';

  try {
    // Parse ISO date (YYYY-MM-DD)
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return `${year}年${parseInt(month, 10)}月${parseInt(day, 10)}日`;
    }

    // Try generic date parsing
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return value;
    }

    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  } catch {
    return value;
  }
};

/**
 * Number formatter - adds thousand separators
 */
export const numberFormatter: Formatter = (value: string) => {
  if (!value || value === '') return '';

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  return num.toLocaleString('ja-JP');
};

/**
 * Yen formatter - currency format with ¥ symbol
 */
export const yenFormatter: Formatter = (value: string) => {
  if (!value || value === '') return '';

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  return `¥${num.toLocaleString('ja-JP')}`;
};

// ============================================
// Format Application
// ============================================

/**
 * Format a value using the specified formatter
 */
export function format(value: string, formatName: string | undefined): string {
  const formatter = getFormatter(formatName);
  return formatter(value);
}

/**
 * Format for alignment
 */
export function align(value: string, _alignment: string | undefined): string {
  // v0.1: alignment is handled at rendering time (text-anchor for SVG)
  // This function is reserved for future text manipulation
  return value;
}

// ============================================
// Custom Formatter Registration
// ============================================

/**
 * Register formatters from template config
 */
export function registerCustomFormatters(
  formatters: Record<string, { kind?: string; pattern?: string; currency?: string }>
): void {
  for (const [name, def] of Object.entries(formatters)) {
    if (def.kind === 'date' && def.pattern) {
      registerFormatter(name, createDateFormatter(def.pattern));
    } else if (def.kind === 'number' && def.pattern) {
      registerFormatter(name, createNumberFormatter(def.pattern));
    } else if (def.kind === 'currency' && def.currency) {
      registerFormatter(name, createCurrencyFormatter(def.currency));
    }
  }
}

/**
 * Create custom date formatter
 */
function createDateFormatter(_pattern: string): Formatter {
  return (value: string) => {
    if (!value) return '';
    // v0.1: Simple implementation, full pattern support is future work
    return dateFormatter(value);
  };
}

/**
 * Create custom number formatter
 */
function createNumberFormatter(_pattern: string): Formatter {
  return (value: string) => {
    if (!value) return '';
    return numberFormatter(value);
  };
}

/**
 * Create custom currency formatter
 */
function createCurrencyFormatter(currency: string): Formatter {
  return (value: string) => {
    if (!value) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return `${currency}${num.toLocaleString('ja-JP')}`;
  };
}
