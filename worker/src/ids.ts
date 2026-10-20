/** A prefixed random id, such as `call_3f2a…`. */
export const newId = (prefix: 'req' | 'sup' | 'call' | 'q' | 'evt') =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
