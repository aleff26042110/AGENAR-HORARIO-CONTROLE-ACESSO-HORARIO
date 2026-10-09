/* Agenda Josi — cliente Supabase compartilhado.
 * Requer: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * Uso:
 *   const { supabase, config } = await JosiSupabase.init({ requireSession: false });
 *   // requireSession: true → redireciona para ../login/ se não houver sessão
 */
(function () {
  'use strict';

  async function init(opts = {}) {
    const config = await window.JosiConfig.load();
    if (!config.configured) {
      const err = new Error('Supabase não configurado.');
      err.code = 'SUPABASE_NOT_CONFIGURED';
      err.config = config;
      throw err;
    }
    if (!window.supabase || !window.supabase.createClient) {
      throw new Error('SDK do Supabase não carregou. Verifique a conexão.');
    }
    const supabase = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    if (opts.requireSession) {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const here = encodeURIComponent(window.location.href);
        window.location.href = `../login/?next=${here}`;
        throw new Error('Sessão necessária.');
      }
    }
    return { supabase, config };
  }

  // Retorna { profile, professional, subscription } para o usuário logado.
  // professional: vinculado via professionals.user_id = auth.uid().
  // subscription: assinatura mais recente da professional.
  async function loadContext(supabase, options = {}) {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return { user: null, profile: null, professional: null, subscription: null };
    const agendaSlug = options.agendaSlug || null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, role')
      .eq('id', user.id)
      .maybeSingle();

    let professional = null;
    if (profile && profile.role !== 'administrador') {
      // Permite ?prof=<uuid> para futura segunda profissional no mesmo login.
      const forced = new URLSearchParams(window.location.search).get('prof');
      if (forced) {
        const { data } = await supabase.from('professionals').select('*').eq('id', forced).maybeSingle();
        // Só aceita se for dona ou admin (RLS já barra o resto).
        professional = data && (!agendaSlug || data.identidade_visual?.agenda === agendaSlug) ? data : null;
      }
      if (!professional) {
        const { data: professionals } = await supabase
          .from('professionals')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });
        professional = agendaSlug
          ? (professionals || []).find((item) => item.identidade_visual?.agenda === agendaSlug) || null
          : (professionals || [])[0] || null;
      }
    }

    let subscription = null;
    if (professional) {
      const { data } = await supabase
        .from('subscriptions')
        .select('*, plans(nome)')
        .eq('professional_id', professional.id)
        .order('vencimento', { ascending: false })
        .limit(1)
        .maybeSingle();
      subscription = data || null;
    }
    return { user, profile, professional, subscription };
  }

  function accessBlocked(professional, subscription) {
    if (!professional) return { blocked: true, reason: 'Nenhuma profissional vinculada a este login.' };
    if (professional.status === 'Bloqueado' || professional.status === 'Suspenso') {
      return { blocked: true, reason: `Conta ${professional.status.toLowerCase()}. Fale com o administrador.` };
    }
    if (!subscription) return { blocked: false };
    if (subscription.status === 'Bloqueado' || subscription.status === 'Suspenso') {
      return { blocked: true, reason: `Assinatura ${subscription.status.toLowerCase()}. Fale com o administrador.` };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (subscription.vencimento < today || subscription.status === 'Vencido' || professional.status === 'Vencido') {
      return { blocked: true, reason: 'Assinatura vencida. Renove para continuar usando a agenda.' };
    }
    return { blocked: false };
  }

  async function signOutAndGoLogin(supabase) {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = '../login/';
    }
  }

  window.JosiSupabase = { init, loadContext, accessBlocked, signOutAndGoLogin };
})();
