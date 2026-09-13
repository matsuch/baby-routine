/**
 * Curvas da OMS e referências diárias.
 *
 * Os valores esperados são medianas e limites publicados pela OMS — se algum
 * destes quebrar, a tabela gerada saiu errada e a tela vai mentir sobre o
 * crescimento de uma criança de verdade.
 */
import {
  avaliar, zScore, valorNoZ, zParaPercentil, lmsNaIdade, classificar, refXixi, refCoco,
} from '../assets/js/crescimento.js';

const falhas = [];
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok ' : 'FALHOU'}  ${msg}`); if (!cond) falhas.push(msg); };
const perto = (a, b, tol) => Math.abs(a - b) <= tol;

const M = 30.4375;
const mes = (n) => Math.round(n * M);

console.log('\ncurvas da OMS');

// Medianas publicadas: quem está exatamente na mediana tem z = 0.
for (const [ind, sexo, m, valor] of [
  ['peso', 'female', 0, 3.2322], ['peso', 'male', 0, 3.3464],
  ['peso', 'female', 12, 8.9462], ['peso', 'male', 12, 9.6479],
  ['altura', 'female', 0, 49.1477], ['altura', 'male', 12, 75.7488],
]) {
  const r = avaliar(ind, valor, sexo, mes(m));
  ok(perto(r.z, 0, 0.01), `${ind} ${sexo} ${m}m na mediana dá z≈0 (deu ${r.z.toFixed(3)})`);
  ok(perto(r.percentil, 50, 1), `${ind} ${sexo} ${m}m na mediana dá percentil≈50 (deu ${r.percentil.toFixed(1)})`);
}

// Limites -2SD/+2SD publicados pela OMS para peso-para-idade.
for (const [sexo, m, z, esperado] of [
  ['female', 0, -2, 2.4], ['female', 0, 2, 4.2],
  ['male', 0, -2, 2.5], ['male', 0, 2, 4.4],
  ['female', 12, -2, 7.0], ['female', 12, 2, 11.5],
  ['male', 12, -2, 7.7], ['male', 12, 2, 12.0],
]) {
  const v = valorNoZ(z, lmsNaIdade('peso', sexo, mes(m)));
  ok(perto(v, esperado, 0.1), `peso ${sexo} ${m}m no z=${z} é ${esperado}kg (deu ${v.toFixed(2)})`);
}

// Ida e volta: z → valor → z tem que fechar.
{
  const lms = lmsNaIdade('peso', 'female', mes(6));
  const fecha = [-2.5, -1, 0, 1.3, 2.5].every((z) => perto(zScore(valorNoZ(z, lms), lms), z, 1e-9));
  ok(fecha, 'zScore e valorNoZ são inversos');
}

console.log('\npercentis');
ok(perto(zParaPercentil(0), 50, 0.01), 'z=0 é o percentil 50');
ok(perto(zParaPercentil(-1.881), 3, 0.05), 'z=-1,881 é o percentil 3');
ok(perto(zParaPercentil(1.881), 97, 0.05), 'z=+1,881 é o percentil 97');
ok(perto(zParaPercentil(-2), 2.275, 0.01), 'z=-2 é o percentil 2,3');
ok(zParaPercentil(-4) > 0 && zParaPercentil(4) < 100, 'percentil nunca satura em 0 nem 100');

console.log('\nclassificação');
ok(classificar(0) === 'esperado', 'z=0 é esperado');
ok(classificar(-1.9) === 'esperado', 'z=-1,9 ainda é esperado');
ok(classificar(-2.5) === 'atencao' && classificar(2.5) === 'atencao', '|z|>2 vira atenção');
ok(classificar(-3.5) === 'alerta' && classificar(3.5) === 'alerta', '|z|>3 vira alerta');

console.log('\nlimites e entradas ruins');
ok(avaliar('peso', 8, 'female', null) === null, 'sem idade não avalia');
ok(avaliar('peso', 0, 'female', 100) === null, 'peso zero não avalia');
ok(avaliar('peso', 8, '', 100) === null, 'sem sexo não avalia');
ok(avaliar('peso', 12, 'female', mes(200)) !== null, 'idade além da tabela fixa na última linha');
ok(lmsNaIdade('peso', 'female', mes(2.5))[1] > lmsNaIdade('peso', 'female', mes(2))[1],
  'interpola entre meses: a mediana cresce de 2m para 2,5m');

console.log('\nreferências diárias');
ok(refXixi(0).min === 1, 'no 1º dia espera-se 1 xixi');
ok(refXixi(3).min === 4, 'no 4º dia espera-se 4 xixis');
ok(refXixi(10).min === 6 && refXixi(300).min === 6, 'a partir do 5º dia o piso é 6 xixis');
ok(refCoco(10).min === 3, 'no 1º mês espera-se ao menos 3 cocôs');
ok(refCoco(90) === null, 'depois das 6 semanas não há meta de cocô — a variação normal é grande');
ok(refXixi(null) === null && refCoco(null) === null, 'sem idade não há referência');

console.log(falhas.length ? `\nFALHOU:\n- ${falhas.join('\n- ')}` : '\nOK — curvas da OMS e referências passaram.');
process.exit(falhas.length ? 1 : 0);
