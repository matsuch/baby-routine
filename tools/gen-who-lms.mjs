/**
 * Gera assets/js/who-lms.js a partir das tabelas oficiais da OMS.
 *
 *   npm run gen:who
 *
 * O app é um PWA estático sem build: o pacote `who-growth-standards` (1,1 MB,
 * resolução diária) é grande demais para o service worker pré-cachear. Aqui
 * amostramos só o que a tela usa — peso-para-idade e altura-para-idade, os dois
 * sexos, um ponto por mês até 5 anos — e o app interpola entre os meses.
 *
 * O arquivo gerado NÃO deve ser editado à mão: rode o script de novo.
 */
import { getTable, lookupLms } from 'who-growth-standards';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SAIDA = path.join(RAIZ, 'assets', 'js', 'who-lms.js');

const DIAS_MES = 30.4375; // a própria OMS ancora os meses neste valor
const MESES = 60;
const INDICADORES = ['wfa', 'lhfa'];
const SEXOS = ['female', 'male'];

/** 4 casas bastam: o z-score muda menos de 0,001 em relação à tabela diária. */
const red = (n) => Number(n.toFixed(5));

function serie(indicador, sexo) {
  const tabela = getTable(indicador, sexo);
  const linhas = [];
  for (let mes = 0; mes <= MESES; mes += 1) {
    const { l, m, s } = lookupLms(tabela, Math.round(mes * DIAS_MES));
    linhas.push(`  [${red(l)}, ${red(m)}, ${red(s)}],`);
  }
  return linhas.join('\n');
}

const blocos = [];
for (const ind of INDICADORES) {
  for (const sexo of SEXOS) {
    blocos.push(`/** ${ind} · ${sexo} — [L, M, S] por mês, 0 a ${MESES}. */
export const ${ind}_${sexo} = [
${serie(ind, sexo)}
];`);
  }
}

const cabecalho = `/**
 * Padrões de Crescimento Infantil da OMS — tabelas LMS.
 *
 * GERADO POR tools/gen-who-lms.mjs — NÃO EDITE À MÃO.
 *
 * Fonte: World Health Organization, WHO Child Growth Standards
 * https://www.who.int/tools/child-growth-standards
 * Extraído do pacote npm who-growth-standards (MIT), que empacota as tabelas
 * publicadas pela OMS. Este projeto não tem vínculo com a OMS.
 *
 * Cada entrada é [L, M, S] para um mês de idade (índice = mês, 0 a ${MESES}).
 * wfa  = peso para idade (kg)
 * lhfa = comprimento/altura para idade (cm)
 */

`;

fs.writeFileSync(SAIDA, cabecalho + blocos.join('\n\n') + '\n');
console.log(`escrito ${path.relative(RAIZ, SAIDA)} — ${(fs.statSync(SAIDA).size / 1024).toFixed(1)} KB`);
