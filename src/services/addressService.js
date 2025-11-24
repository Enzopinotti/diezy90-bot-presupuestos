// src/services/addressService.js
// ----------------------------------------------------
// Parseo simple de direcciones “rioplatenses”: “122 y 50, La Plata”,
// “City Bell”, “Villa Elisa 189”, CP si aparece, etc.

function clean(s=''){return String(s).trim();}

export function parseAddress(text='') {
  const t = String(text||'').toLowerCase();

  // Esquina: "122 y 50, La Plata"
  let m = t.match(/\b(\d{1,3})\s*y\s*(\d{1,3})(?:[,;\s]+([\p{L}\s.]+))?/u);
  if (m) {
    return {
      type: 'corner',
      streetA: clean(m[1]),
      streetB: clean(m[2]),
      city: clean(m[3]||''),
      raw: text
    };
  }

  // Calle + número: "58 1370, La Plata"
  m = t.match(/\b([\p{L}\s.]+?)\s+(\d{1,5})(?:[,;\s]+([\p{L}\s.]+))?/u);
  if (m) {
    return {
      type: 'street_number',
      street: clean(m[1]),
      number: clean(m[2]),
      city: clean(m[3]||''),
      raw: text
    };
  }

  // Localidad sola: “City Bell”, “Villa Elisa”
  m = t.match(/\b(city bell|villa elisa|tolosa|gonnet|ringuelet|berisso|ensenada|la plata)\b/);
  if (m) {
    return { type: 'locality', city: clean(m[1]), raw: text };
  }

  // Código postal argentino (opcional)
  const cp = t.match(/\b(\d{4})\b/);
  return { type: 'free', city: '', postalCode: cp ? cp[1] : null, raw: text };
}

export function formatAddressParsed(parsed) {
  if (!parsed) return '';
  if (parsed.type === 'corner') {
    return `Esquina ${parsed.streetA} y ${parsed.streetB}${parsed.city ? `, ${parsed.city}` : ''}`;
    }
  if (parsed.type === 'street_number') {
    return `${parsed.street} ${parsed.number}${parsed.city ? `, ${parsed.city}` : ''}`;
  }
  if (parsed.type === 'locality') return parsed.city;
  return parsed.raw || '';
}
