export default function BrandLogo() {
  return (
    <img
      className="brand-logo"
      src={new URL('../brand/caselite-logo.png', window.location.href).href}
      alt="CaseLite 獬豸标识"
      width={32}
      height={32}
      draggable={false}
    />
  );
}
