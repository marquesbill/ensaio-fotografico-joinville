/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { 
  Quote as QuoteIcon, 
  Camera, 
  Sparkles, 
  Heart, 
  Users, 
  CheckCircle, 
  XCircle, 
  MapPin, 
  ArrowRight, 
  ChevronDown,
  Instagram,
  ExternalLink,
  Star
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
};

const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1
    }
  }
};

const pulsingGlow = {
  animate: {
    boxShadow: [
      "0 0 0 0px rgba(168,85,247,0.3)",
      "0 0 30px 15px rgba(168,85,247,0.4)",
      "0 0 0 0px rgba(168,85,247,0.3)"
    ],
    transition: {
      duration: 2.5,
      repeat: Infinity,
      ease: "easeInOut"
    }
  }
};

function useCountdown(targetDate: Date) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const diff = targetDate.getTime() - Date.now();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
    return {
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = targetDate.getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        clearInterval(interval);
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

// ⚠️ ATENÇÃO: Atualize esta data conforme necessário
const PROMO_DEADLINE = new Date('2026-05-12T23:59:59');

function CountdownTimer() {
  const { days, hours, minutes, seconds } = useCountdown(PROMO_DEADLINE);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expired = days === 0 && hours === 0 && minutes === 0 && seconds === 0;
  return (
    <div className="mt-3 mb-2 rounded-2xl px-3 py-3 border border-white/20" style={{ background: 'linear-gradient(135deg, rgba(122,63,143,0.12), rgba(232,112,90,0.12))' }}>
      <p className="font-bold text-xs uppercase tracking-widest text-center mb-2" style={{ color: '#c44f82' }}>
        {expired ? '🔒 Oferta encerrada' : '⏰ Oferta expira em'}
      </p>
      <div className="flex justify-center gap-2 text-center">
        {[{ v: pad(days), l: 'dias' }, { v: pad(hours), l: 'hrs' }, { v: pad(minutes), l: 'min' }, { v: pad(seconds), l: 'seg' }].map(({ v, l }) => (
          <div key={l} className="flex flex-col items-center">
            <span
              className="text-white font-black text-xl leading-none px-2 py-1 rounded-lg min-w-[2.4rem] tabular-nums"
              style={{ background: 'linear-gradient(135deg, #7a3f8f, #e87060)' }}
            >{v}</span>
            <span className="text-[10px] font-bold mt-1 uppercase" style={{ color: '#c44f82' }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      const scrollAmount = direction === 'left' ? -400 : 400;
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const shuffleArray = (array: string[]) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  return (
    <div className="min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center justify-center pt-8 pb-12 px-6 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            alt="Hero Background"
            className="w-full h-full object-cover"
            style={{ objectPosition: 'center 20%' }}
            src="/hero-bg-new.jpg"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-surface/10 via-surface/40 to-surface"></div>
        </div>
        
        {/* Header Overlay Removed */}

        <div className="container mx-auto relative z-10 grid md:grid-cols-2 gap-12 items-center mt-20">
          <motion.div 
            className="space-y-6"
            initial="initial"
            animate="animate"
            variants={staggerContainer}
          >
            <motion.span 
              variants={fadeIn}
              className="inline-block px-4 py-1 rounded-full bg-primary-container/80 text-on-primary-container text-sm font-bold tracking-widest uppercase backdrop-blur-md"
            >
              Joinville 2026
            </motion.span>
            <motion.div variants={fadeIn} className="py-6 inline-block relative">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-300/15 to-purple-500/10 blur-3xl rounded-full scale-150"></div>
              <div className="logo-shimmer-wrapper relative z-10">
                <motion.img
                  alt="A Essência do Movimento"
                  className="h-28 md:h-40 w-auto"
                  src="/logo-w.png"
                  animate={{
                    filter: [
                      'drop-shadow(0 0 6px rgba(255,255,255,0.20)) drop-shadow(0 8px 18px rgba(0,0,0,0.45))',
                      'drop-shadow(0 0 18px rgba(255,255,255,0.55)) drop-shadow(0 0 32px rgba(196,79,130,0.28)) drop-shadow(0 8px 18px rgba(0,0,0,0.35))',
                      'drop-shadow(0 0 6px rgba(255,255,255,0.20)) drop-shadow(0 8px 18px rgba(0,0,0,0.45))',
                    ]
                  }}
                  transition={{
                    duration: 3.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: 0.5,
                  }}
                />
              </div>
            </motion.div>
            <motion.p 
              variants={fadeIn}
              className="text-xl md:text-2xl text-on-surface font-semibold"
            >
              21 de Julho a 02 de Agosto
            </motion.p>
            <motion.p
              variants={fadeIn}
              className="font-medium max-w-md p-6 rounded-2xl leading-relaxed"
              style={{
                background: 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(18px)',
                WebkitBackdropFilter: 'blur(18px)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.15)',
                color: '#f0f4ff',
                textShadow: '0 1px 4px rgba(0,0,0,0.4)',
              }}
            >
              Uma experiência fotográfica exclusiva durante o maior festival de dança do mundo. Vagas limitadas para bailarinos que desejam eternizar sua arte.
            </motion.p>
          </motion.div>

          <motion.div
            id="cadastro"
            className="p-10 rounded-3xl border border-white/70 max-w-md mx-auto w-full bg-white/10 backdrop-blur-lg relative"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: 1,
              scale: 1,
              boxShadow: [
                "0 0 15px 5px rgba(255,255,255,0.5)",
                "0 0 25px 10px rgba(255,255,255,0.65)",
                "0 0 15px 5px rgba(255,255,255,0.5)"
              ]
            }}
            transition={{
              opacity: { duration: 0.6, delay: 0.3 },
              scale: { duration: 0.6, delay: 0.3 },
              boxShadow: {
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 0.9
              }
            }}
          >
            <div className="-mx-10 -mt-10 mb-6 pt-7 pb-4 px-6 rounded-t-3xl border-b border-white/20" style={{ background: 'linear-gradient(135deg, #7a3f8f, #e87060)' }}>
              <h3 className="font-headline text-3xl md:text-4xl text-center text-white font-black drop-shadow-lg uppercase leading-tight tracking-tight">
                Tenha acesso à<br/><span className="text-white/90">Pré-venda Exclusiva</span>
              </h3>
              <p className="text-white/80 text-center text-sm mt-2 font-medium tracking-wide">Vagas limitadas · Preço especial por tempo limitado</p>
            </div>
            <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
              <div>
                <input 
                  className="w-full bg-white/90 border border-white/80 focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-4 placeholder:text-gray-600 text-gray-900 font-bold shadow-inner transition-colors" 
                  placeholder="Seu Nome" 
                  type="text" 
                />
              </div>
              <div>
                <input 
                  className="w-full bg-white/90 border border-white/80 focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-4 placeholder:text-gray-600 text-gray-900 font-bold shadow-inner transition-colors" 
                  placeholder="WhatsApp (DDD)" 
                  type="tel" 
                />
              </div>
              <div>
                <input 
                  className="w-full bg-white/90 border border-white/80 focus:ring-2 focus:ring-primary focus:bg-white rounded-xl px-4 py-4 placeholder:text-gray-600 text-gray-900 font-bold shadow-inner transition-colors" 
                  placeholder="E-mail" 
                  type="email" 
                />
              </div>
              <button 
                className="w-full signature-gradient text-white font-bold py-5 rounded-full shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-lg mt-4" 
                type="submit"
              >
                Garantir minha Vaga
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      {/* Poetic Quote Section */}
      <section className="py-24 bg-surface-container-low relative">
        <div className="container mx-auto px-6 text-center max-w-4xl">
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
            <QuoteIcon className="mx-auto text-primary w-16 h-16 mb-6 opacity-30" />
          </motion.div>
          <div className="space-y-4">
            <motion.p 
              className="font-headline text-3xl md:text-4xl text-on-surface leading-relaxed"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              "Queremos te entregar fotos perfeitas, impecáveis. Cuidamos de tudo para isso."
            </motion.p>
            <motion.p 
              className="text-lg md:text-xl text-primary font-medium italic"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
            >
              Montamos nossa estrutura no hotel Le Village, na mesma avenida do Centreventos.
            </motion.p>
          </div>
          <motion.div 
            className="mt-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.6 }}
          >
            <a href="#cadastro" className="inline-block signature-gradient text-white font-bold px-12 py-5 rounded-full shadow-xl hover:scale-105 active:scale-95 transition-all duration-300 text-lg">
              Entrar na Fila de Espera
            </a>
          </motion.div>
        </div>
        <div className="absolute bottom-0 left-0 w-full h-16 bg-surface sinuous-divider"></div>
      </section>

      {/* Packages Section */}
      <section className="py-24 bg-surface-container-low relative overflow-hidden">
        <div className="container mx-auto px-6">
          <motion.h2 
            className="font-headline text-4xl text-on-surface text-center mb-4"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Escolha seu Pacote
          </motion.h2>
          <motion.p 
            className="text-center text-on-surface-variant mb-16 max-w-xl mx-auto"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Selecione a experiência que melhor se adapta ao seu momento na dança. Vagas limitadas por categoria.
          </motion.p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-end">
            {/* Package 1 */}
            <motion.div
              className="glass-card p-10 rounded-[2.5rem] border border-white/60 shadow-xl flex flex-col h-full hover:scale-[1.02] transition-transform duration-500 order-2 md:order-1 bg-white/70"
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="mb-6">
                <h3 className="font-headline text-2xl text-on-surface mb-3">Lembrança</h3>
                <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 mb-2">
                  <p className="text-gray-400 text-sm line-through">de R$ 1.800</p>
                  <p className="text-green-600 font-black text-4xl leading-tight">R$ 1.400</p>
                  <p className="text-amber-700 font-bold text-xs uppercase tracking-wide mt-1">🔥 Pré-venda — economize R$400</p>
                </div>
                <CountdownTimer />
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                <li className="flex items-center gap-3 text-sm font-medium">
                  <CheckCircle className="text-primary w-5 h-5" />
                  30 minutos de sessão
                </li>
                <li className="flex items-center gap-3 text-sm font-medium">
                  <CheckCircle className="text-primary w-5 h-5" />
                  Pode ser dividido por até 2 pessoas
                </li>
              </ul>
              <a href="#cadastro" className="block text-center w-full py-4 rounded-full border-2 border-primary text-primary font-bold hover:bg-primary hover:text-white transition-colors">Selecionar</a>
            </motion.div>

            {/* Package 2 - Popular */}
            <motion.div
              className="relative bg-white/70 backdrop-blur-3xl p-10 rounded-[2.5rem] border-2 border-primary shadow-2xl flex flex-col h-full transform md:scale-110 z-10 order-1 md:order-2 ring-4 ring-primary/10"
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 signature-gradient text-white text-xs font-bold px-6 py-2 rounded-full uppercase tracking-widest shadow-lg">Mais Procurado</div>
              <div className="mb-6">
                <h3 className="font-headline text-2xl text-on-surface mb-3">Econômico</h3>
                <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl px-4 py-3 mb-2">
                  <p className="text-gray-400 text-sm line-through">de R$ 2.400</p>
                  <p className="text-green-600 font-black text-4xl leading-tight">R$ 1.900</p>
                  <p className="text-amber-700 font-bold text-xs uppercase tracking-wide mt-1">🔥 Pré-venda — economize R$500</p>
                </div>
                <CountdownTimer />
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                <li className="flex items-center gap-3 text-sm font-bold">
                  <CheckCircle className="text-primary w-5 h-5" />
                  1 hora de sessão
                </li>
                <li className="flex items-center gap-3 text-sm font-bold">
                  <CheckCircle className="text-primary w-5 h-5" />
                  Pode ser dividido por até 3 pessoas
                </li>
              </ul>
              <a href="#cadastro" className="block text-center w-full py-5 rounded-full signature-gradient text-white font-bold shadow-lg hover:brightness-110 transition-all text-lg">Selecionar</a>
            </motion.div>

            {/* Package 3 */}
            <motion.div
              className="glass-card p-10 rounded-[2.5rem] border border-white/60 shadow-xl flex flex-col h-full hover:scale-[1.02] transition-transform duration-500 order-3 bg-white/70"
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="mb-6">
                <h3 className="font-headline text-2xl text-on-surface mb-3">Completo</h3>
                <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 mb-2">
                  <p className="text-gray-400 text-sm line-through">de R$ 2.800</p>
                  <p className="text-green-600 font-black text-4xl leading-tight">R$ 2.500</p>
                  <p className="text-amber-700 font-bold text-xs uppercase tracking-wide mt-1">🔥 Pré-venda — economize R$300</p>
                </div>
                <CountdownTimer />
              </div>
              <ul className="space-y-4 mb-10 flex-grow">
                <li className="flex items-center gap-3 text-sm font-medium">
                  <CheckCircle className="text-primary w-5 h-5" />
                  2 horas de sessão
                </li>
                <li className="flex items-center gap-3 text-sm font-medium">
                  <CheckCircle className="text-primary w-5 h-5" />
                  Pode ser dividido por até 4 pessoas
                </li>
              </ul>
              <a href="#cadastro" className="block text-center w-full py-4 rounded-full border-2 border-primary text-primary font-bold hover:bg-primary hover:text-white transition-colors">Selecionar</a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* For Whom Section */}
      <section className="py-24 bg-surface">
        <div className="container mx-auto px-6">
          <motion.h2 
            className="font-headline text-4xl text-on-surface text-center mb-16 italic"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            Para quem é este ensaio
          </motion.h2>
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8"
            variants={staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
          >
            {[
              { icon: Camera, title: "Material para Audição", desc: "Fotos técnicas e expressivas para companhias e escolas internacionais.", color: "bg-tertiary-container", iconColor: "text-tertiary" },
              { icon: Sparkles, title: "Iniciantes e Amadores", desc: "Celebrando cada etapa da sua evolução no mundo da dança.", color: "bg-primary-container/30", iconColor: "text-primary" },
              { icon: Heart, title: "Feito para quem ama a dança", desc: "Para quem vive e respira a arte do movimento todos os dias.", color: "bg-surface-container-high", iconColor: "text-on-surface" },
              { icon: Users, title: "Mães de Bailarinas", desc: "Eternizando o sonho e a dedicação da sua filha nos palcos.", color: "bg-secondary-container", iconColor: "text-secondary" }
            ].map((item, i) => (
              <motion.div 
                key={i}
                variants={fadeIn}
                className="bg-surface-container-low/50 border border-outline-variant/10 p-8 rounded-2xl flex flex-col items-center text-center space-y-4 hover:translate-y-[-12px] transition-all duration-500 shadow-sm hover:shadow-xl group"
              >
                <div className={`w-16 h-16 rounded-full ${item.color} flex items-center justify-center transition-colors group-hover:bg-primary group-hover:text-white`}>
                  <item.icon className={`${item.iconColor} w-8 h-8 group-hover:text-white transition-colors`} />
                </div>
                <h4 className="font-bold text-on-surface">{item.title}</h4>
                <p className="text-sm text-on-surface-variant">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

            {/* Testimonials Section */}
      <section className="py-24 bg-surface-container-low relative overflow-hidden">
        <div className="container mx-auto px-6 relative z-10">
          <motion.div 
            className="text-center max-w-3xl mx-auto mb-16"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-headline text-4xl md:text-5xl text-on-surface mb-6">O que dizem sobre a experiência</h2>
            <p className="text-on-surface-variant text-lg">Histórias reais de quem já viveu a essência do movimento através das nossas lentes.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                name: "Samantha Cortez",
                text: "Fotógrafo simplesmente incrível 💕 obrigada pelo carinho e pela paciência comigo 💝 Eu estou apaixonada pelas fotos 💜",
                img: "https://static.wixstatic.com/media/2cf4d4_d13271842b2b457290e5012a49faa891~mv2.png/v1/fill/w_361,h_314,al_c,lg_1,q_85,enc_avif,quality_auto/2cf4d4_d13271842b2b457290e5012a49faa891~mv2.png"
              },
              {
                name: "Pedro Paulo Bravo",
                text: "Andreeee, acabei de ver!! Que obra prima!! Como sempre tudo perfeito!! Muito obrigado! Amei cada click! 😍❤️",
                img: "https://static.wixstatic.com/media/2cf4d4_a6d30b7b95a244969decb4d27d7a12eb~mv2.png/v1/crop/x_0,y_22,w_232,h_223/fill/w_325,h_312,al_c,lg_1,q_85,enc_avif,quality_auto/2cf4d4_a6d30b7b95a244969decb4d27d7a12eb~mv2.png"
              },
              {
                name: "Juliana Siqueira",
                text: "É um privilégio ter tantas imagens lindas produzidas por pessoas com tamanha sensibilidade. Considero minhas fotos dançando - na sala de aula, no palco, no estúdio ou em qualquer lugar - um dos meus maiores tesouros 🧡",
                img: "https://static.wixstatic.com/media/2cf4d4_aee0d5ed23b64d968549e2f719641e55~mv2.png/v1/crop/x_0,y_0,w_227,h_190/fill/w_318,h_266,al_c,lg_1,q_85,enc_avif,quality_auto/2cf4d4_aee0d5ed23b64d968549e2f719641e55~mv2.png"
              }
            ].map((testimonial, idx) => (
              <motion.div
                key={idx}
                className="glass-card p-8 rounded-3xl border border-white/20 bg-white/40 backdrop-blur-md shadow-xl hover:shadow-2xl transition-all"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.2 }}
              >
                <div className="flex gap-1 mb-6 text-primary">
                  {[...Array(5)].map((_, i) => <Star key={i} className="w-5 h-5 fill-current" />)}
                </div>
                <p className="text-on-surface-variant italic mb-8 leading-relaxed">"{testimonial.text}"</p>
                <div className="flex items-center gap-4">
                  <img src={testimonial.img} alt={testimonial.name} className="w-14 h-14 rounded-full object-cover border-2 border-primary/20" />
                  <h4 className="font-bold text-on-surface">{testimonial.name}</h4>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

{/* Brands Grid Section */}
      <section className="py-24 bg-surface">
        <div className="container mx-auto px-6">
          <h2 className="font-headline text-4xl md:text-5xl text-center mb-16 text-on-surface uppercase">Por onde minhas fotos já passaram</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {[
              { name: "Logo 1", img: "/logos/Logo 1_edited_edited.avif" },
              { name: "Logo 2", img: "/logos/Logo 2_edited.avif" },
              { name: "Logo 4", img: "/logos/Logo 4_edited_edited.avif" },
              { name: "Logo 5", img: "/logos/Logo 5_edited_edited.avif" },
              { name: "Logo 6", img: "/logos/Logo 6_edited.avif" },
              { name: "IMG 9897", img: "/logos/IMG_9897_edited.avif" },
              { name: "IMG 9900", img: "/logos/IMG_9900_edited_edited_edited.avif" },
              { name: "IMG 9901", img: "/logos/IMG_9901_PNG.avif" },
              { name: "IMG 9907", img: "/logos/IMG_9907_edited_edited_edited.avif" }
            ].map((brand, i) => (
              <motion.div
                key={i}
                className="brand-logo-item group hover:shadow-lg transition-shadow"
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <div className="w-full h-full relative bg-white/5 rounded-xl overflow-hidden flex items-center justify-center p-4">
                  <img
                    alt={`${brand.name} Logo`}
                    className="max-w-full max-h-full object-contain"
                    src={brand.img}
                    referrerPolicy="no-referrer"
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Location Section */}
      <section className="py-24 bg-surface-container-low overflow-hidden relative" id="location">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <motion.div 
              className="relative order-2 md:order-1 flex flex-col items-center"
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-white w-full max-w-lg aspect-[4/5] relative bg-surface-container">
                <iframe 
                  src="https://maps.google.com/maps?q=Hotel%20Le%20Village,%20Joinville&t=&z=15&ie=UTF8&iwloc=&output=embed" 
                  className="absolute inset-0 w-full h-full border-0" 
                  allowFullScreen 
                  loading="lazy" 
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Mapa para Hotel Le Village, Joinville"
                ></iframe>
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 signature-gradient text-white px-8 py-3 rounded-full text-sm font-bold shadow-lg whitespace-nowrap pointer-events-none">
                  Sala Esmeralda
                </div>
              </div>
            </motion.div>

            <motion.div 
              className="space-y-8 order-1 md:order-2"
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div>
                <h2 className="font-headline text-4xl text-on-surface mb-4">Onde estamos</h2>
                <p className="text-primary font-bold text-xl">Hotel Le Village, Sala Esmeralda</p>
                <p className="text-on-surface-variant mt-4 leading-relaxed">Localizado no coração de Joinville, nosso estúdio temporário oferece infraestrutura completa para o seu ensaio, com total privacidade e salas preparadas para trocas de figurino e preparação técnica.</p>
              </div>
              <div id="cadastro-footer" className="glass-card p-8 rounded-2xl space-y-4 border border-white/40 shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] bg-white/5 backdrop-blur-2xl">
                <div className="flex flex-col gap-4">
                  <input className="w-full bg-white/80 border border-white/50 rounded-xl px-4 py-4 placeholder:text-gray-500 focus:ring-2 focus:ring-primary focus:bg-white text-gray-900 font-medium shadow-inner transition-colors" placeholder="Nome completo" type="text" />
                  <input className="w-full bg-white/80 border border-white/50 rounded-xl px-4 py-4 placeholder:text-gray-500 focus:ring-2 focus:ring-primary focus:bg-white text-gray-900 font-medium shadow-inner transition-colors" placeholder="WhatsApp" type="tel" />
                  <input className="w-full bg-white/80 border border-white/50 rounded-xl px-4 py-4 placeholder:text-gray-500 focus:ring-2 focus:ring-primary focus:bg-white text-gray-900 font-medium shadow-inner transition-colors" placeholder="Melhor E-mail" type="email" />
                </div>
                <button className="w-full signature-gradient text-white font-bold py-4 rounded-full shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-lg mt-2">Quero meu ensaio</button>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Visual Showcase */}
      <section className="py-24 bg-surface-container-lowest overflow-hidden">
        <div className="container mx-auto px-6 mb-8 flex justify-between items-end">
          <div>
            <h2 className="font-headline text-4xl text-on-surface mb-2">Nosso Portfólio</h2>
            <p className="text-on-surface-variant">Deslize para ver mais momentos eternizados.</p>
          </div>
          <div className="hidden md:flex gap-2">
            <button 
              onClick={() => scrollCarousel('left')}
              className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
            >
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <button 
              onClick={() => scrollCarousel('right')}
              className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shadow-md hover:brightness-110 transition-all cursor-pointer"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="w-full relative">
          <div 
            ref={carouselRef}
            className="flex overflow-x-auto snap-x snap-mandatory gap-4 px-6 pb-12 pt-4 scrollbar-hide" 
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {shuffleArray([
              "/carrossel/germana_0164-Enhanced-NR.jpg",
              "/carrossel/germana_0107-Enhanced-NR.jpg",
              "/carrossel/jon25_4830.jpg",
              "/carrossel/jon25_4824.jpg",
              "/carrossel/jon25_4812.jpg",
              "/carrossel/jon25_4814.jpg",
              "/carrossel/baunilha_1462-Enhanced-NR.jpg",
              "/carrossel/baunilha_1504-Enhanced-NR.jpg",
              "/carrossel/jon25_3092.jpg",
              "/carrossel/jon25_3088.jpg",
              "/carrossel/join25_2761.png",
              "/carrossel/join25_2758.png",
              "/carrossel/join25_2208.jpg",
              "/carrossel/join25_2215.jpg",
              "/carrossel/join25_12.jpg",
              "/carrossel/join25_18.jpg",
              "/carrossel/join25_15.jpg"
            ]).map((src, i) => (
              <motion.div 
                key={i}
                className="snap-center shrink-0 w-[80vw] md:w-[400px] aspect-[3/4] rounded-2xl shadow-lg overflow-hidden relative group cursor-grab active:cursor-grabbing"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <img 
                  alt={`Dance Showcase ${i + 1}`} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                  src={src}
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </motion.div>
            ))}
            <div className="shrink-0 w-6 md:w-12"></div>
          </div>
        </div>
      </section>

      {/* The Artist */}
      <section className="py-24 bg-surface">
        <div className="container mx-auto px-6 max-w-5xl">
          <div className="flex flex-col md:flex-row items-center justify-center gap-16">
            <motion.div 
              className="w-72 h-72 md:w-96 md:h-96 shrink-0 rounded-3xl overflow-hidden border-[12px] border-surface-container shadow-2xl relative"
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
            >
              <img
                alt="André Ferreira"
                className="w-full h-full object-cover object-top"
                src="/andre.jpg"
              />
            </motion.div>
            <motion.div
              className="space-y-6 flex-1 text-center md:text-left"
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-primary font-bold tracking-widest uppercase text-sm">André Ferreira</span>
              <h2 className="font-headline text-4xl text-on-surface italic">@affotografia</h2>
              <p className="text-on-surface-variant text-lg leading-relaxed">André Ferreira é fotógrafo especializado em dança, atuando em estúdios, salas de aula e espetáculos. Com formação anterior em engenharia elétrica e ciência da computação, e passagens por desenvolvimento de software e laboratório de realidade virtual, dedica-se à fotografia de dança há 13 anos. Busca registrar o movimento, a forma e o detalhe, refletindo seu estilo e o estilo da bailarina em suas imagens.</p>
              <a className="inline-flex items-center gap-2 text-primary font-bold hover:underline transition-all group" href="#">
                Siga no Instagram
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-24 bg-surface-container-low relative">
        <div className="absolute top-0 left-0 w-full h-16 bg-surface sinuous-divider-inv"></div>
        <div className="container mx-auto px-6 max-w-3xl pt-16">
          <h2 className="font-headline text-4xl text-center mb-16">Dúvidas Frequentes</h2>
          <div className="space-y-4">
            {[
              { q: "Quando serão os ensaios?", a: "Os ensaios ocorrerão em datas selecionadas. Fique atento às nossas redes sociais para o anúncio dos próximos lotes." },
              { q: "Onde serão feitas as fotos?", a: "No Hotel Le Village, Sala Esmeralda, em Joinville. Um ambiente preparado com infraestrutura completa." },
              { q: "Quem pode fazer o ensaio?", a: "Bailarinos de todas as idades e níveis, desde iniciantes até profissionais, de qualquer modalidade." },
              { q: "Quanto tempo dura o ensaio?", a: "Nossos ensaios duram entre 30 a 90 minutos, dependendo do pacote escolhido." },
              { q: "O que eu vou receber?", a: "Você receberá fotos editadas em alta resolução em uma galeria online privativa e elegante." },
              { q: "Serão quantos lotes?", a: "Trabalhamos com lotes limitados para garantir a exclusividade e a qualidade de cada ensaio." },
              { q: "Quais são as formas de pagamento?", a: "Aceitamos PIX, transferência bancária e cartões de crédito (com possibilidade de parcelamento)." },
              { q: "Tem pacote especial para grupos?", a: "Sim! Oferecemos condições especiais para grupos de bailarinos da mesma escola ou companhia. Entre em contato." }
            ].map((faq, i) => (
              <motion.div 
                key={i}
                className="glass-card rounded-2xl overflow-hidden border border-white/60 shadow-sm bg-white/70"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <button 
                  className="flex justify-between items-center w-full p-6 text-left cursor-pointer select-none"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="font-bold text-on-surface">{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                <motion.div 
                  initial={false}
                  animate={{ height: openFaq === i ? "auto" : 0, opacity: openFaq === i ? 1 : 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-6 text-on-surface-variant">
                    {faq.a}
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Floating WhatsApp Button */}
      <motion.a
        className="fixed bottom-8 right-8 z-50 w-16 h-16 bg-[#25D366] text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all"
        href="https://wa.me/551151960627"
        target="_blank"
        rel="noopener noreferrer"
        initial={{ scale: 0 }}
        animate={{
          scale: 1,
          boxShadow: [
            "0 0 15px 5px rgba(37,211,102,0.5)",
            "0 0 25px 10px rgba(37,211,102,0.65)",
            "0 0 15px 5px rgba(37,211,102,0.5)"
          ]
        }}
        transition={{
          scale: { type: "spring", stiffness: 260, damping: 20, delay: 1 },
          boxShadow: {
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2
          }
        }}
      >
        <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.483 8.413-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.308 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.438 9.889-9.886.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"></path>
        </svg>
      </motion.a>

      {/* Footer */}
      <footer className="w-full flex flex-col items-center px-12 py-16 gap-8 bg-secondary-container/30 rounded-t-[4rem] border-t border-primary/10">
        <div className="container mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
          <div className="flex flex-col items-center md:items-start gap-4">
            <img
              alt="Ensaio Fotográfico em Joinville"
              className="h-12 w-auto opacity-80"
              src="/logo-b.png"
            />
            <p className="font-bold text-primary italic text-lg">André Ferreira Fotografia | Brasil</p>
            <p className="text-[10px] md:text-xs uppercase tracking-widest text-primary/60">
              © 2026 ANDRÉ FERREIRA FOTOGRAFIA | JOINVILLE, BRAZIL
            </p>
          </div>
          <div className="flex gap-12">
            <a className="text-sm uppercase tracking-[0.2em] text-primary/60 hover:text-primary transition-colors font-bold flex items-center gap-2" href="#">
              <Instagram className="w-4 h-4" />
              Instagram
            </a>
            <a className="text-sm uppercase tracking-[0.2em] text-primary/60 hover:text-primary transition-colors font-bold flex items-center gap-2" href="#">
              <ExternalLink className="w-4 h-4" />
              Portfólio
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
