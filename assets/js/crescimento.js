/**
 * Comparação do crescimento com o esperado para a idade.
 *
 * Duas fontes, bem diferentes em natureza:
 *
 *  - Peso e altura saem das tabelas LMS da OMS (who-lms.js, geradas por
 *    tools/gen-who-lms.mjs). São curvas publicadas, específicas por sexo.
 *  - Xixi e cocô são orientações gerais de puericultura, não curvas: existe
 *    um piso razoável nas primeiras semanas e, depois disso, a variação
 *    normal é grande demais para virar meta. Quando não há referência
 *    honesta a dar, estas funções devolvem null — e a tela não desenha nada.
 *
 * Nada aqui é conselho médico.
 */
import { wfa_female, wfa_male, lhfa_female, lhfa_male } from './who-lms.js';

const DIAS_MES = 30.4375;
const TABELAS = {
  peso: { female: wfa_female, male: wfa_male },
  altura: { female: lhfa_female, male: lhfa_male },
};

/** Interpola [L, M, S] entre os meses vizinhos. Fora da tabela, fixa na ponta. */
export function lmsNaIdade(indicador, sexo, dias) {
  const tabela = TABELAS[indicador]?.[sexo];
  if (!tabela) return null;
  const mes = Math.max(0, dias / DIAS_MES);
  if (mes >= tabela.length - 1) return tabela[tabela.length - 1];
  const base = Math.floor(mes);
  const frac = mes - base;
  const a = tabela[base];
  const b = tabela[base + 1];
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * frac);
}

/** Fórmula LMS da OMS: quantos desvios-padrão o valor está da mediana. */
export function zScore(valor, [l, m, s]) {
  if (!(valor > 0) || !(m > 0) || !(s > 0)) return null;
  return l === 0 ? Math.log(valor / m) / s : ((valor / m) ** l - 1) / (l * s);
}

/** Caminho inverso: que valor cai neste z-score (para desenhar a faixa). */
export function valorNoZ(z, [l, m, s]) {
  return l === 0 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l);
}

/** Normal padrão acumulada (Abramowitz & Stegun 26.2.17), erro < 7,5e-8. */
export function zParaPercentil(z) {
  const sinal = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 50 * (1 + sinal * y);
}

/**
 * Avalia peso (kg) ou altura (cm) contra a curva da OMS.
 * Devolve null quando falta sexo ou data de nascimento — sem eles não há curva.
 */
export function avaliar(indicador, valor, sexo, dias) {
  if (!valor || dias == null || dias < 0) return null;
  const lms = lmsNaIdade(indicador, sexo, dias);
  if (!lms) return null;
  const z = zScore(valor, lms);
  if (z == null || !Number.isFinite(z)) return null;
  return {
    z,
    percentil: zParaPercentil(z),
    mediana: lms[1],
    p3: valorNoZ(-1.881, lms),  // percentil 3
    p97: valorNoZ(1.881, lms),  // percentil 97
    faixa: classificar(z),
  };
}

/**
 * Faixas da OMS por z-score. "atencao" é o que a OMS marca como fora dos
 * limites usuais (|z| > 2) — um sinal para conversar com o pediatra, nunca
 * um diagnóstico.
 */
export function classificar(z) {
  if (z < -3 || z > 3) return 'alerta';
  if (z < -2 || z > 2) return 'atencao';
  return 'esperado';
}

/**
 * Xixis por dia. Nos primeiros dias a diurese sobe junto com a descida do
 * leite (1 no dia 1, 2 no dia 2...); a partir do 5º dia o piso usual é 6.
 */
export function refXixi(dias) {
  if (dias == null || dias < 0) return null;
  if (dias < 5) return { min: Math.max(1, dias + 1) };
  return { min: 6 };
}

/**
 * Cocôs por dia. Até uma seis semanas espera-se pelo menos 3 ao dia. Depois
 * disso a variação normal vai de vários por dia a um a cada poucos dias, e
 * qualquer "meta" seria inventada — então não devolvemos nenhuma.
 */
export function refCoco(dias) {
  if (dias == null || dias < 0) return null;
  return dias <= 42 ? { min: 3 } : null;
}
