export interface ScriptScene {
  id: string;
  label: string;
  directionHint: string;
  text: string;
}

export interface MaleVoiceOption {
  id: "Charon" | "Fenrir" | "Puck";
  name: string;
  timbre: string;
  description: string;
  sampleText: string;
}

export interface StylePreset {
  id: string;
  label: string;
  stylePrompt: string;
}

export const INITIAL_SCENES: ScriptScene[] = [
  {
    id: "scene-1",
    label: "Abertura Institucional",
    directionHint: "Tom acolhedor e firme, convidando o espectador.",
    text: "Na Afya Pato Branco, você vive a Medicina desde o primeiro dia de aula.",
  },
  {
    id: "scene-2",
    label: "Corpo Docente e Prática",
    directionHint: "Ritmo fluido, destacando ensino médico e vivência prática.",
    text: "Aqui, você aprende com professores médicos, metodologias inovadoras de ensino e muita prática.",
  },
  {
    id: "scene-3",
    label: "Ambulatório Escola",
    directionHint: "Ênfase calorosa no impacto social e atendimento à comunidade.",
    text: "No Ambulatório Escola, são mais de 20 especialidades e atendimentos à comunidade.",
  },
  {
    id: "scene-4",
    label: "Centro de Simulação",
    directionHint: "Clareza técnica e segurança ao citar alta fidelidade.",
    text: "No Centro de Simulação em Saúde, tecnologias de alta fidelidade preparam você para os desafios da profissão.",
  },
  {
    id: "scene-5",
    label: "Internato e Hospitais",
    directionHint: "Tom maduro e realista sobre a vivência hospitalar.",
    text: "E, no internato, a experiência ganha diferentes cenários, incluindo hospitais de referência.",
  },
  {
    id: "scene-6",
    label: "Acreditação SAEME e Carreira",
    directionHint: "Articulação nítida em SAEME e projeção internacional.",
    text: "O curso tem acreditação SAEME, do Conselho Federal de Medicina, e oferece oportunidades de internacionalização e carreira no Brasil e no exterior.",
  },
  {
    id: "scene-7",
    label: "Pato Branco",
    directionHint: "Conexão regional orgulhosa e direta.",
    text: "Tudo isso em Pato Branco, um dos principais centros de saúde do Paraná.",
  },
  {
    id: "scene-8",
    label: "Assinatura Final",
    directionHint: "Pausa breve antes de cada frase; fechamento solene e memorável.",
    text: "Afya Pato Branco. Medicina de excelência. Compromisso com a vida.",
  },
];

export const MALE_VOICES: MaleVoiceOption[] = [
  {
    id: "Charon",
    name: "Charon",
    timbre: "Grave e solene",
    description: "Voz masculina profunda e segura, ideal para locução institucional clássica e vídeos de marca.",
    sampleText: "Afya Pato Branco. Medicina de excelência. Compromisso com a vida.",
  },
  {
    id: "Fenrir",
    name: "Fenrir",
    timbre: "Firme e acolhedor",
    description: "Timbre masculino encorpado com calor humano, ótimo para documentários e histórias reais.",
    sampleText: "Na Afya Pato Branco, você vive a Medicina desde o primeiro dia de aula.",
  },
  {
    id: "Puck",
    name: "Puck",
    timbre: "Claro e contemporâneo",
    description: "Voz masculina articulada e energética, indicada para campanhas digitais e ritmo moderno.",
    sampleText: "Aqui, você aprende com professores médicos, metodologias inovadoras de ensino e muita prática.",
  },
];

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "institucional-solene",
    label: "Institucional Solene",
    stylePrompt:
      "Locução institucional em português brasileiro (pt-BR), voz masculina grave, serena, confiante e inspiradora, com dicção impecável, cadência cinematográfica e pausas bem marcadas entre as frases.",
  },
  {
    id: "documentario-acolhedor",
    label: "Documentário Acolhedor",
    stylePrompt:
      "Narração em português brasileiro (pt-BR) em estilo documentário médico, voz masculina calorosa, próxima e humana, transmitindo credibilidade acadêmica e cuidado com a vida.",
  },
  {
    id: "campanha-dinamica",
    label: "Campanha Moderna",
    stylePrompt:
      "Locução publicitária contemporânea em português brasileiro (pt-BR), voz masculina firme, expressiva e envolvente, com ritmo dinâmico e ênfase nos diferenciais do curso de Medicina.",
  },
  {
    id: "pausado-enfatico",
    label: "Pausado e Enfático",
    stylePrompt:
      "Locução pausada e enfática em português brasileiro (pt-BR), voz masculina madura e articulada, valorizando cada pausa dramática e destacando a assinatura final com autoridade.",
  },
];
