// J1939 SPN (Suspect Parameter Number) and FMI (Failure Mode Identifier) lookup
// Covers common heavy-duty truck SPNs seen on 2013+ Mack/Volvo

export const FMI_DESCRIPTIONS: Record<number, string> = {
  0: "Data valid but above normal range",
  1: "Data valid but below normal range",
  2: "Data erratic, intermittent, or incorrect",
  3: "Voltage above normal or shorted high",
  4: "Voltage below normal or shorted low",
  5: "Current below normal or open circuit",
  6: "Current above normal or grounded",
  7: "Mechanical system not responding properly",
  8: "Abnormal frequency, pulse width, or period",
  9: "Abnormal update rate",
  10: "Abnormal rate of change",
  11: "Root cause not known",
  12: "Bad intelligent device or component",
  13: "Out of calibration",
  14: "Special instructions",
  15: "Data valid but above normal — least severe",
  16: "Data valid but above normal — moderately severe",
  17: "Data valid but below normal — least severe",
  18: "Data valid but below normal — moderately severe",
  19: "Received network data in error",
  20: "Data drifted high",
  21: "Data drifted low",
  31: "Condition exists",
};

export interface SPNInfo {
  name: string;
  description: string;
  fix: string;
  severity: "info" | "warning" | "critical";
}

export const SPN_LOOKUP: Record<number, SPNInfo> = {
  // Engine
  27: { name: "EGR Valve Position", description: "Exhaust Gas Recirculation valve position sensor", fix: "Check EGR valve for carbon buildup, clean or replace", severity: "warning" },
  51: { name: "Throttle Position", description: "Throttle position sensor circuit", fix: "Check throttle position sensor wiring, replace sensor if faulty", severity: "warning" },
  84: { name: "Vehicle Speed", description: "Wheel-based vehicle speed sensor", fix: "Check speed sensor and wiring at transmission", severity: "warning" },
  91: { name: "Accelerator Pedal Position", description: "Accelerator pedal or lever position sensor", fix: "Check pedal sensor connector, replace sensor", severity: "warning" },
  94: { name: "Fuel Delivery Pressure", description: "Fuel pressure at the injection pump", fix: "Check fuel filter, fuel lines, lift pump", severity: "warning" },
  97: { name: "Water in Fuel", description: "Water detected in fuel system", fix: "Drain water separator, replace fuel filter", severity: "warning" },
  100: { name: "Engine Oil Pressure", description: "Engine oil pressure sensor or actual pressure", fix: "Check oil level, oil pressure sensor, oil pump", severity: "critical" },
  102: { name: "Boost Pressure", description: "Turbocharger boost pressure", fix: "Check turbo, intercooler hoses, boost pressure sensor", severity: "warning" },
  105: { name: "Intake Manifold Temperature", description: "Intake manifold air temperature", fix: "Check intake temp sensor, intercooler", severity: "info" },
  107: { name: "Air Filter Restriction", description: "Air filter differential pressure", fix: "Replace air filter element", severity: "info" },
  108: { name: "Barometric Pressure", description: "Barometric pressure sensor", fix: "Check sensor, usually altitude-related", severity: "info" },
  110: { name: "Engine Coolant Temperature", description: "Engine coolant temperature sensor", fix: "Check coolant level, thermostat, temp sensor", severity: "critical" },
  111: { name: "Coolant Level", description: "Engine coolant level sensor", fix: "Check coolant level, top up, check for leaks", severity: "critical" },
  157: { name: "Injector Timing Rail Pressure", description: "Common rail fuel pressure", fix: "Check high-pressure fuel pump, rail pressure sensor, injectors", severity: "critical" },
  158: { name: "Battery Voltage", description: "Battery/charging system voltage", fix: "Check alternator, battery connections, battery condition", severity: "warning" },
  164: { name: "Injection Control Pressure", description: "HEUI injection control pressure", fix: "Check IPR valve, high-pressure oil pump", severity: "critical" },
  168: { name: "Battery Potential", description: "Electrical system battery voltage", fix: "Check alternator output, battery cables, batteries", severity: "warning" },
  171: { name: "Ambient Air Temperature", description: "Outside air temperature sensor", fix: "Check ambient temp sensor", severity: "info" },
  174: { name: "Fuel Temperature", description: "Fuel temperature sensor", fix: "Check fuel temp sensor, fuel return line", severity: "info" },
  175: { name: "Engine Oil Temperature", description: "Engine oil temperature sensor", fix: "Check oil temp sensor, oil cooler", severity: "warning" },
  190: { name: "Engine Speed", description: "Engine RPM sensor (crankshaft)", fix: "Check crankshaft position sensor and wiring", severity: "critical" },

  // Aftertreatment / Emissions (very common on 2013+ trucks)
  520: { name: "Actual Engine Torque", description: "Actual engine percent torque", fix: "Check engine sensors, may be derate condition", severity: "warning" },
  523: { name: "Transmission Current Gear", description: "Current transmission gear", fix: "Check transmission controller, gear sensor", severity: "warning" },
  524: { name: "Transmission Selected Gear", description: "Selected transmission gear", fix: "Check gear selector, transmission controller", severity: "warning" },
  597: { name: "Brake Switch", description: "Brake pedal switch", fix: "Check brake light switch, wiring", severity: "warning" },
  598: { name: "Clutch Switch", description: "Clutch pedal switch", fix: "Check clutch switch, wiring", severity: "info" },
  611: { name: "Crankcase Pressure", description: "Engine crankcase pressure", fix: "Check crankcase breather, worn rings possible", severity: "warning" },
  627: { name: "Compressor Discharge Pressure", description: "A/C compressor discharge pressure", fix: "Check A/C system pressure, refrigerant level", severity: "info" },
  629: { name: "ECU Internal", description: "Engine Control Unit internal fault", fix: "Try key cycle, reflash ECU if persistent", severity: "critical" },
  630: { name: "ECU Power Supply", description: "ECU power supply voltage", fix: "Check ECU power/ground connections", severity: "critical" },
  651: { name: "Injector Cylinder 1", description: "Fuel injector #1 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  652: { name: "Injector Cylinder 2", description: "Fuel injector #2 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  653: { name: "Injector Cylinder 3", description: "Fuel injector #3 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  654: { name: "Injector Cylinder 4", description: "Fuel injector #4 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  655: { name: "Injector Cylinder 5", description: "Fuel injector #5 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  656: { name: "Injector Cylinder 6", description: "Fuel injector #6 circuit", fix: "Check injector wiring, replace injector", severity: "critical" },
  723: { name: "Engine Brake Actuator", description: "Engine brake / jake brake actuator", fix: "Check engine brake solenoid and wiring", severity: "warning" },
  899: { name: "Engine Torque Mode", description: "Engine torque limitation active", fix: "Check for other active codes causing derate", severity: "warning" },

  // DPF / SCR / DEF (most common modern truck codes)
  1569: { name: "DPF Outlet Temperature", description: "Diesel Particulate Filter outlet temp sensor", fix: "Check DPF outlet temp sensor, do regen if needed", severity: "warning" },
  1761: { name: "DPF Differential Pressure", description: "DPF soot load differential pressure", fix: "Perform forced regen, clean/replace DPF if high soot", severity: "warning" },
  2631: { name: "DPF Active Regen", description: "DPF active regeneration status", fix: "Allow regen to complete, do not shut off engine during regen", severity: "info" },
  2659: { name: "DPF Status", description: "Diesel Particulate Filter overall status", fix: "Check DPF soot load, perform regen or clean DPF", severity: "warning" },
  3216: { name: "AFT SCR Conversion", description: "Aftertreatment SCR catalyst conversion efficiency", fix: "Check DEF quality, SCR catalyst, NOx sensors", severity: "warning" },
  3226: { name: "AFT DEF Tank Level", description: "Aftertreatment Diesel Exhaust Fluid tank level", fix: "Top up DEF fluid. Check DEF level sensor if full but showing low", severity: "warning" },
  3230: { name: "AFT SCR Intake NOx", description: "SCR intake NOx sensor reading", fix: "Check NOx sensor, DEF dosing, SCR catalyst", severity: "warning" },
  3242: { name: "AFT DEF Quality", description: "DEF (urea) quality/concentration", fix: "Drain and replace DEF with fresh fluid, check DEF quality sensor", severity: "warning" },
  3246: { name: "AFT DEF Dosing", description: "DEF dosing valve or pump", fix: "Check DEF pump, dosing valve, DEF lines for crystallization", severity: "warning" },
  3251: { name: "AFT SCR Outlet NOx", description: "SCR outlet NOx sensor reading", fix: "Check outlet NOx sensor, SCR catalyst efficiency", severity: "warning" },
  3362: { name: "AFT DPF Inlet Temperature", description: "DPF inlet exhaust temperature", fix: "Check DPF inlet temp sensor and wiring", severity: "warning" },
  3364: { name: "AFT DOC Inlet Temperature", description: "Diesel Oxidation Catalyst inlet temp", fix: "Check DOC inlet temp sensor", severity: "warning" },
  3556: { name: "AFT DEF Tank Temperature", description: "DEF fluid temperature in tank", fix: "Check DEF tank heater in cold weather, temp sensor", severity: "info" },
  3563: { name: "AFT 7th Injector", description: "Aftertreatment hydrocarbon injector (DPF regen)", fix: "Check 7th injector for fuel supply and operation", severity: "warning" },
  3609: { name: "AFT DEF Line Heater", description: "DEF supply line heater circuit", fix: "Check DEF line heater relay and wiring, common in cold weather", severity: "info" },
  3610: { name: "AFT DEF Return Line Heater", description: "DEF return line heater", fix: "Check DEF return heater relay and wiring", severity: "info" },
  3719: { name: "AFT DEF Pump Pressure", description: "DEF pump/dosing system pressure", fix: "Check DEF pump, filter, lines for blockage or crystallization", severity: "warning" },

  // Transmission / Drivetrain
  4078: { name: "Trans Oil Life", description: "Transmission fluid life remaining", fix: "Schedule transmission fluid change", severity: "info" },

  // Body / Cab
  5018: { name: "High Beam", description: "High beam headlight circuit", fix: "Check headlight bulb, relay, wiring", severity: "info" },
  5246: { name: "AFT System Status", description: "Overall aftertreatment system status/derate warning", fix: "Check DEF level and quality, clear codes after fix, monitor", severity: "warning" },

  // Common Mack/Volvo specific
  3031: { name: "EGR Mass Flow", description: "EGR system mass flow rate", fix: "Clean EGR valve and cooler, check EGR actuator", severity: "warning" },
  3936: { name: "AFT DPF Soot Load", description: "DPF soot load percentage", fix: "Perform forced regen, replace DPF if soot won't burn off", severity: "warning" },
  4094: { name: "NOx Level Exceeded", description: "Tailpipe NOx emissions exceed limit", fix: "Check DEF system, SCR catalyst, may trigger derate", severity: "critical" },
  4364: { name: "Coolant Flow", description: "Engine coolant flow rate", fix: "Check water pump, thermostat, coolant hoses", severity: "warning" },
  5298: { name: "Idle Shutdown Timer", description: "Engine idle shutdown timer active", fix: "Normal operation — engine will shut down after idle timer", severity: "info" },
};

export function lookupSPN(spn: number): SPNInfo {
  return SPN_LOOKUP[spn] || {
    name: `SPN ${spn}`,
    description: "Unknown parameter — check J1939 SPN database",
    fix: "Consult service manual for this specific code",
    severity: "warning" as const,
  };
}

export function lookupFMI(fmi: number): string {
  return FMI_DESCRIPTIONS[fmi] || `Unknown failure mode ${fmi}`;
}
