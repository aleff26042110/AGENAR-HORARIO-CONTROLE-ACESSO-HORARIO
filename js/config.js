/* Agenda Josi — configuração do Supabase (frontend, chave pública apenas).
 * Ordem de leitura:
 *  1. window.__SUPABASE_CONFIG__ (inline, ex. GitHub Pages via secret de build)
 *  2. ./js/config.json (arquivo local, NÃO commitar — ver config.example.json)
 *  3. localStorage "agenda-josi:config" (configuração já salva neste aparelho)
 * NUNCA coloque service_role aqui. Só SUPABASE_URL + SUPABASE_ANON_KEY.
 */
(function () {
  'use strict';

  const LS_KEY = 'agenda-josi:config';

  function readLS() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  async function readConfigFile(path) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) return null;
      const config = await res.json();
      return config && config.url && config.anonKey ? config : null;
    } catch {
      return null;
    }
  }

  async function readFile() {
    return (await readConfigFile('./js/config.json'))
      || (await readConfigFile('../js/config.json'))
      || {};
  }

  async function load() {
    const inlineCfg = window.__SUPABASE_CONFIG__ || {};
    const fileCfg = await readFile();
    const lsCfg = readLS();
    const cfg = {
      url: inlineCfg.url || fileCfg.url || lsCfg.url || '',
      anonKey: inlineCfg.anonKey || fileCfg.anonKey || lsCfg.anonKey || '',
    };
    return {
      ...cfg,
      configured: Boolean(cfg.url && cfg.anonKey),
      save(next) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ url: next.url, anonKey: next.anonKey }));
        } catch {}
      },
      clear() {
        try {
          localStorage.removeItem(LS_KEY);
        } catch {}
      },
    };
  }

  window.JosiConfig = { load, LS_KEY };
})();
