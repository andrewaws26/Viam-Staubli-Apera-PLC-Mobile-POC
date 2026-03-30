/**
 * OBD-II P-code lookup table.
 * Maps standard diagnostic trouble codes to human-readable descriptions and fix suggestions.
 */

interface PCodeInfo {
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  fix: string;
}

const PCODE_DB: Record<string, PCodeInfo> = {
  // Fuel and air metering
  P0100: { name: "MAF Circuit Malfunction", description: "Mass Air Flow sensor circuit has a malfunction", severity: "warning", fix: "Check MAF sensor connector. Clean or replace MAF sensor." },
  P0101: { name: "MAF Circuit Range/Performance", description: "Mass Air Flow sensor reading is out of expected range", severity: "warning", fix: "Clean MAF sensor with MAF cleaner. Check for vacuum leaks." },
  P0102: { name: "MAF Circuit Low Input", description: "Mass Air Flow sensor voltage is too low", severity: "warning", fix: "Check MAF wiring and connector. Replace MAF sensor if damaged." },
  P0103: { name: "MAF Circuit High Input", description: "Mass Air Flow sensor voltage is too high", severity: "warning", fix: "Check for short in MAF circuit. Replace MAF sensor." },
  P0110: { name: "IAT Sensor Circuit", description: "Intake Air Temperature sensor circuit malfunction", severity: "info", fix: "Check IAT sensor connector and wiring." },
  P0113: { name: "IAT Sensor High Input", description: "Intake Air Temperature sensor reading too high", severity: "info", fix: "Check IAT sensor and wiring for open circuit." },
  P0115: { name: "Coolant Temp Sensor Circuit", description: "Engine coolant temperature sensor circuit malfunction", severity: "warning", fix: "Check coolant temp sensor connector and wiring." },
  P0117: { name: "Coolant Temp Low Input", description: "Engine coolant temperature sensor reading too low", severity: "warning", fix: "Check coolant temp sensor. May need replacement." },
  P0118: { name: "Coolant Temp High Input", description: "Engine coolant temperature sensor reading too high", severity: "warning", fix: "Check coolant temp sensor wiring for short." },
  P0121: { name: "TPS Range/Performance", description: "Throttle Position Sensor reading out of expected range", severity: "warning", fix: "Check throttle body and TPS connector. Clean throttle body." },
  P0122: { name: "TPS Circuit Low", description: "Throttle Position Sensor voltage too low", severity: "warning", fix: "Check TPS wiring. Replace TPS if needed." },
  P0128: { name: "Coolant Thermostat", description: "Coolant thermostat stuck open — engine not reaching operating temperature", severity: "info", fix: "Replace thermostat. Check coolant level." },
  P0130: { name: "O2 Sensor Circuit (B1S1)", description: "Oxygen sensor circuit malfunction, Bank 1 Sensor 1", severity: "warning", fix: "Check O2 sensor wiring. Replace upstream O2 sensor." },
  P0131: { name: "O2 Sensor Low Voltage (B1S1)", description: "Upstream O2 sensor reading consistently low voltage", severity: "warning", fix: "Check for vacuum leaks. Replace O2 sensor." },
  P0133: { name: "O2 Sensor Slow Response (B1S1)", description: "Upstream O2 sensor responding too slowly", severity: "warning", fix: "Replace upstream O2 sensor." },
  P0134: { name: "O2 Sensor No Activity (B1S1)", description: "No activity detected from upstream O2 sensor", severity: "warning", fix: "Check O2 sensor heater circuit. Replace O2 sensor." },
  P0135: { name: "O2 Sensor Heater (B1S1)", description: "Oxygen sensor heater circuit malfunction", severity: "info", fix: "Check O2 sensor heater fuse and wiring. Replace O2 sensor." },
  P0136: { name: "O2 Sensor Circuit (B1S2)", description: "Downstream O2 sensor circuit malfunction", severity: "info", fix: "Check downstream O2 sensor wiring. Replace if needed." },
  P0138: { name: "O2 Sensor High Voltage (B1S2)", description: "Downstream O2 sensor reading consistently high", severity: "info", fix: "Check for exhaust leaks. Replace downstream O2 sensor." },
  P0141: { name: "O2 Sensor Heater (B1S2)", description: "Downstream O2 sensor heater circuit malfunction", severity: "info", fix: "Check heater fuse and wiring. Replace O2 sensor." },
  P0171: { name: "System Too Lean (B1)", description: "Fuel system running too lean on Bank 1", severity: "warning", fix: "Check for vacuum leaks, clean MAF sensor, check fuel pressure." },
  P0172: { name: "System Too Rich (B1)", description: "Fuel system running too rich on Bank 1", severity: "warning", fix: "Check fuel injectors, MAP/MAF sensor, purge valve." },
  P0174: { name: "System Too Lean (B2)", description: "Fuel system running too lean on Bank 2", severity: "warning", fix: "Check for vacuum leaks on Bank 2 side. Check intake gaskets." },
  P0175: { name: "System Too Rich (B2)", description: "Fuel system running too rich on Bank 2", severity: "warning", fix: "Check fuel injectors on Bank 2. Check for leaking injectors." },

  // Ignition system
  P0300: { name: "Random/Multiple Misfire", description: "Multiple cylinders are misfiring randomly", severity: "critical", fix: "Check spark plugs, ignition coils, fuel injectors. Check compression." },
  P0301: { name: "Cylinder 1 Misfire", description: "Misfire detected in cylinder 1", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 1." },
  P0302: { name: "Cylinder 2 Misfire", description: "Misfire detected in cylinder 2", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 2." },
  P0303: { name: "Cylinder 3 Misfire", description: "Misfire detected in cylinder 3", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 3." },
  P0304: { name: "Cylinder 4 Misfire", description: "Misfire detected in cylinder 4", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 4." },
  P0305: { name: "Cylinder 5 Misfire", description: "Misfire detected in cylinder 5", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 5." },
  P0306: { name: "Cylinder 6 Misfire", description: "Misfire detected in cylinder 6", severity: "warning", fix: "Check spark plug, ignition coil, and fuel injector for cylinder 6." },
  P0325: { name: "Knock Sensor Circuit (B1)", description: "Knock sensor circuit malfunction on Bank 1", severity: "warning", fix: "Check knock sensor wiring. Replace knock sensor." },
  P0335: { name: "Crankshaft Position Sensor", description: "Crankshaft position sensor circuit malfunction", severity: "critical", fix: "Check CKP sensor gap and wiring. Replace sensor." },
  P0340: { name: "Camshaft Position Sensor", description: "Camshaft position sensor circuit malfunction", severity: "critical", fix: "Check CMP sensor and wiring. Check timing chain/belt." },

  // Catalytic converter / emissions
  P0420: { name: "Catalyst Efficiency Low (B1)", description: "Catalytic converter efficiency below threshold on Bank 1", severity: "warning", fix: "Catalytic converter may need replacement. Check for exhaust leaks." },
  P0430: { name: "Catalyst Efficiency Low (B2)", description: "Catalytic converter efficiency below threshold on Bank 2", severity: "warning", fix: "Catalytic converter may need replacement. Check downstream O2 sensor." },
  P0440: { name: "EVAP System Malfunction", description: "Evaporative emission control system malfunction", severity: "info", fix: "Check gas cap. Inspect EVAP system hoses and purge valve." },
  P0441: { name: "EVAP Incorrect Purge Flow", description: "EVAP purge flow is not as expected", severity: "info", fix: "Check purge valve and EVAP canister. Check vacuum lines." },
  P0442: { name: "EVAP Small Leak", description: "Small leak detected in evaporative emission system", severity: "info", fix: "Tighten gas cap. Smoke test EVAP system for small leaks." },
  P0443: { name: "EVAP Purge Valve Circuit", description: "EVAP purge control valve circuit malfunction", severity: "info", fix: "Check purge valve connector. Replace purge valve." },
  P0446: { name: "EVAP Vent Control", description: "EVAP vent control circuit malfunction", severity: "info", fix: "Check EVAP vent solenoid and wiring." },
  P0449: { name: "EVAP Vent Valve Circuit", description: "EVAP vent valve/solenoid circuit malfunction", severity: "info", fix: "Check vent valve connector. Replace vent valve." },
  P0455: { name: "EVAP Large Leak", description: "Large leak detected in evaporative emission system", severity: "warning", fix: "Check gas cap first. Smoke test EVAP system." },
  P0456: { name: "EVAP Very Small Leak", description: "Very small leak in evaporative emission system", severity: "info", fix: "Tighten or replace gas cap. Inspect EVAP hoses." },

  // Transmission
  P0700: { name: "Transmission Control System", description: "Transmission control system malfunction", severity: "warning", fix: "Check transmission fluid level. Scan transmission module for sub-codes." },
  P0715: { name: "Input Speed Sensor", description: "Transmission input/turbine speed sensor circuit malfunction", severity: "warning", fix: "Check speed sensor wiring. Replace input speed sensor." },
  P0720: { name: "Output Speed Sensor", description: "Transmission output speed sensor circuit malfunction", severity: "warning", fix: "Check speed sensor and wiring. Replace output speed sensor." },
  P0725: { name: "Engine Speed Input Circuit", description: "Engine speed input circuit malfunction in TCM", severity: "warning", fix: "Check CKP sensor signal to transmission module." },
  P0740: { name: "TCC Circuit Malfunction", description: "Torque converter clutch circuit malfunction", severity: "warning", fix: "Check TCC solenoid and wiring. May need transmission service." },
  P0750: { name: "Shift Solenoid A", description: "Shift solenoid A malfunction", severity: "warning", fix: "Check transmission fluid. Replace shift solenoid A." },

  // Engine controls
  P0500: { name: "Vehicle Speed Sensor", description: "Vehicle speed sensor malfunction", severity: "warning", fix: "Check VSS wiring and connector. Replace speed sensor." },
  P0505: { name: "Idle Control System", description: "Idle air control system malfunction", severity: "info", fix: "Clean throttle body and IAC valve. Check for vacuum leaks." },
  P0507: { name: "Idle Speed High", description: "Engine idle speed higher than expected", severity: "info", fix: "Check for vacuum leaks. Clean throttle body. Check IAC valve." },

  // Nissan-specific common codes
  P0011: { name: "Camshaft Timing Over-Advanced (B1)", description: "Intake camshaft timing over-advanced on Bank 1", severity: "warning", fix: "Check engine oil level/condition. Replace VVT solenoid or timing chain." },
  P0021: { name: "Camshaft Timing Over-Advanced (B2)", description: "Intake camshaft timing over-advanced on Bank 2", severity: "warning", fix: "Check engine oil. Replace VVT solenoid. Inspect timing components." },
  P0037: { name: "HO2S Heater Control Low (B1S2)", description: "Heated oxygen sensor heater control circuit low", severity: "info", fix: "Check O2 sensor heater circuit. Replace downstream O2 sensor." },
};

export function lookupPCode(code: string): PCodeInfo {
  const info = PCODE_DB[code.toUpperCase()];
  if (info) return info;

  // Generic fallback based on code prefix
  const prefix = code.substring(0, 2).toUpperCase();
  const category = code.charAt(2);

  let categoryName = "Unknown System";
  if (category === "0" || category === "1" || category === "2") categoryName = "Fuel/Air Metering";
  else if (category === "3") categoryName = "Ignition System";
  else if (category === "4") categoryName = "Emissions Control";
  else if (category === "5") categoryName = "Speed/Idle Control";
  else if (category === "6") categoryName = "Computer/Output Circuit";
  else if (category === "7" || category === "8" || category === "9") categoryName = "Transmission";

  return {
    name: `${prefix === "P0" ? "Generic" : "Manufacturer"} Code ${code}`,
    description: `${categoryName} fault — refer to vehicle service manual for ${code}`,
    severity: "warning",
    fix: `Look up ${code} for your specific vehicle make/model. May require professional diagnosis.`,
  };
}
