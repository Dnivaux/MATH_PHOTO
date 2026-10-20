import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import { AppBar, IconButton } from '../components/ui';
import { DocState, SolutionDocument } from '../components/solution/SolutionDocument';
import { getSettings, updateSettings } from '../config';
import { Level, LEVEL_LABELS } from '../explain/prompt';
import { explain, explainAvailability } from '../pipeline/explain';
import { enqueue } from '../pipeline/queue';
import { solve } from '../pipeline/solve';
import { Solution, SolveError } from '../pipeline/types';
import { addHistory, getHistoryItem, subscribeHistory, updateHistory } from '../state/history';
import { subscribeModel } from '../explain/modelStore';
import { useTheme } from '../theme';

interface Props {
  route: any;
  navigation: any;
}

type ExplainView = NonNullable<DocState['explain']>;

const LEVELS = (Object.keys(LEVEL_LABELS) as Level[]).map(id => ({ id, label: LEVEL_LABELS[id] }));

const ERROR_TITLES: Record<string, string> = {
  invalid: 'Formule non comprise',
  unsupported: 'Pas encore pris en charge',
  disabled: 'Le serveur est désactivé',
  offline: 'En attente du réseau',
  server: 'Le serveur n’a pas abouti',
  empty: 'Formule vide',
};

/**
 * Revenir sur un écran Solution déjà ouvert (Modifier -> calculatrice -> Résoudre, ou l'historique) ne fait
 * que changer ses paramètres : on remonte alors la vue à neuf, sinon elle garderait l'ancienne formule.
 */
export const SolutionDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const p = route.params ?? {};
  const key = p.historyId ? `h${p.historyId}` : `l${p.latex ?? ''}#${p.ocrConfidence ?? ''}`;
  return <SolutionView key={key} route={route} navigation={navigation} />;
};

const SolutionView: React.FC<Props> = ({ route, navigation }) => {
  const { c, scheme } = useTheme();
  const params: { latex?: string; historyId?: number; ocrConfidence?: number | null } = route.params ?? {};
  const [historyId, setHistoryId] = useState<number | null>(params.historyId ?? null);
  // l'explication peut finir avant que l'entrée d'historique soit créée : on lit l'identifiant à jour
  const historyRef = useRef<number | null>(params.historyId ?? null);
  historyRef.current = historyId;
  const [latex, setLatex] = useState(params.latex ?? '');
  const [phase, setPhase] = useState<DocState['phase']>('loading');
  const [progress, setProgress] = useState('Lecture de la formule…');
  const [error, setError] = useState<DocState['error']>();
  const [solution, setSolution] = useState<Solution | null>(null);
  const [level, setLevel] = useState<Level>(getSettings().level);
  const [ex, setEx] = useState<ExplainView | undefined>();
  const [modelTick, setModelTick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const textRef = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => subscribeModel(() => setModelTick(t => t + 1)), []);

  const showError = (e: unknown) => {
    const code = e instanceof SolveError ? e.code : 'server';
    const queued = e instanceof SolveError && e.queued;
    setError({
      title: ERROR_TITLES[code] ?? 'Échec',
      message: queued
        ? 'Ce problème a besoin du serveur et tu es hors ligne. Il est enregistré dans l’historique et partira dès que la connexion reviendra.'
        : (e as Error).message,
      canRetry: code === 'server' || code === 'offline',
      canEdit: code !== 'offline' || !queued,
      queued,
    });
    setPhase('error');
  };

  const run = useCallback(
    async (opts: { forceServer?: boolean } = {}) => {
      if (!latex) {
        return;
      }
      setPhase('loading');
      setError(undefined);
      setEx(undefined);
      try {
        const sol = await solve(latex, { ocrConfidence: params.ocrConfidence, forceServer: opts.forceServer, onProgress: setProgress });
        setSolution(sol);
        setPhase('done');
        const id = await addHistory(latex, 'done', sol);
        setHistoryId(id);
      } catch (e) {
        if (e instanceof SolveError && e.code === 'offline') {
          const id = await enqueue(latex, { ocrConfidence: params.ocrConfidence });
          setHistoryId(id);
          showError(new SolveError(e.message, 'offline', true));
          return;
        }
        showError(e);
      }
    },
    [latex, params.ocrConfidence],
  );

  // ouverture depuis l'historique, ou nouvelle résolution
  useEffect(() => {
    let alive = true;
    (async () => {
      if (params.historyId) {
        const item = await getHistoryItem(params.historyId);
        if (!alive || !item) {
          return;
        }
        setLatex(item.latex);
        if (item.status === 'done' && item.solution) {
          setSolution(item.solution);
          setPhase('done');
        } else if (item.status === 'pending') {
          showError(new SolveError('', 'offline', true));
        } else {
          showError(new SolveError(item.error ?? 'Échec', 'server'));
        }
      } else {
        run();
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // une question en attente qui vient d'être résolue par la file
  useEffect(() => {
    if (phase !== 'error' || !error?.queued || !historyId) {
      return;
    }
    return subscribeHistory(async () => {
      const item = await getHistoryItem(historyId);
      if (item?.status === 'done' && item.solution) {
        setSolution(item.solution);
        setPhase('done');
      }
    });
  }, [phase, error, historyId]);

  // ---------------------------------------------------------------- explication

  const startExplain = useCallback(async (sol: Solution, lvl: Level) => {
    const av = explainAvailability(sol);
    if (!av.ok) {
      if (av.reason === 'not_eligible') {
        return setEx(undefined);
      }
      return setEx({
        status: 'unavailable',
        level: lvl,
        message: av.message,
        action:
          av.reason === 'no_model'
            ? { id: 'install-model', label: 'Installer le modèle', icon: 'download' }
            : { id: 'open-settings', label: 'Ouvrir les réglages', icon: 'info' },
      });
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    textRef.current = '';
    setEx({ status: 'loading', via: av.via, level: lvl });
    try {
      const out = await explain(
        sol,
        lvl,
        t => {
          textRef.current = t;
          if (!flushTimer.current) {
            flushTimer.current = setTimeout(() => {
              flushTimer.current = null;
              if (!ctrl.signal.aborted || textRef.current) {
                setEx(prev => (prev && prev.level === lvl ? { ...prev, status: 'streaming', text: textRef.current } : prev));
              }
            }, 120);
          }
        },
        ctrl.signal,
      );
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
      }
      flushTimer.current = null;
      setEx({ status: 'done', via: out.source, level: lvl, text: out.text, report: out.report });
      const next = { ...sol, explanation: out };
      setSolution(next);
      if (historyRef.current) {
        updateHistory(historyRef.current, { solution: next }).catch(() => {});
      }
    } catch (e) {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
      }
      flushTimer.current = null;
      if (ctrl.signal.aborted && textRef.current) {
        setEx({ status: 'done', via: av.via, level: lvl, text: textRef.current, report: null });
      } else if (!ctrl.signal.aborted) {
        setEx({
          status: 'error',
          via: av.via,
          level: lvl,
          message: `Explication indisponible : ${(e as Error).message}`,
          action: { id: 'regenerate', label: 'Réessayer', icon: 'retry' },
        });
      }
    }
  }, []);

  useEffect(() => {
    if (phase !== 'done' || !solution) {
      return;
    }
    const cached = solution.explanation;
    if (cached && cached.level === level) {
      setEx({ status: 'done', via: cached.source, level, text: cached.text, report: cached.report });
    } else if (!ex || ex.status === 'unavailable' || ex.level !== level) {
      startExplain(solution, level);
    }
  }, [phase, solution?.result?.latex, level, modelTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => abort.current?.abort(), []);

  const onAction = (action: string, value?: string | null) => {
    switch (action) {
      case 'edit':
        navigation.navigate('Calculator', { initialLatex: solution?.latex ?? latex });
        break;
      case 'retry':
        run();
        break;
      case 'verify-server':
        run({ forceServer: true });
        break;
      case 'level':
        if (value && value !== level) {
          setLevel(value as Level);
          updateSettings({ level: value as Level });
        }
        break;
      case 'stop':
        abort.current?.abort();
        break;
      case 'regenerate':
        if (solution) {
          startExplain({ ...solution, explanation: undefined }, level);
        }
        break;
      case 'install-model':
      case 'open-settings':
        navigation.navigate('Settings');
        break;
    }
  };

  const docState: DocState = {
    phase,
    latex: solution?.latex ?? latex,
    kindLabel: solution?.kindLabel,
    progress,
    error,
    solution: solution ?? undefined,
    explain: phase === 'done' ? ex : undefined,
    canVerifyServer: phase === 'done' && solution?.route === 'local' && getSettings().allowServer && !!solution.apiType,
    levels: LEVELS,
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={c.bg} />
      <AppBar
        title="Solution"
        onBack={() => navigation.goBack()}
        right={<IconButton icon={Pencil} label="Modifier la formule" onPress={() => onAction('edit')} />}
      />
      <SolutionDocument state={docState} onAction={onAction} />
    </View>
  );
};
