import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { Screen } from "@/components/screen";
import { SelectField } from "@/components/select-field";
import {
  commonEuropeanBrands,
  commonVehicleColors,
  commonVehicleTypes
} from "@/features/vehicles/vehicle-options";
import { normalizeDutchPlate } from "@/features/vehicles/normalize-dutch-plate";
import { useAppState } from "@/lib/state/app-state";
import { palette } from "@/theme/palette";
import { typography } from "@/theme/typography";

export default function VehicleScreen() {
  const router = useRouter();
  const { registerVehicle, state } = useAppState();
  const [plateInput, setPlateInput] = useState(state.vehicleProfile.plate || "");
  const [brandInput, setBrandInput] = useState(state.vehicleProfile.brand || "");
  const [vehicleTypeInput, setVehicleTypeInput] = useState(state.vehicleProfile.vehicleType || "");
  const [colorInput, setColorInput] = useState(state.vehicleProfile.color || "");
  const [openSelect, setOpenSelect] = useState<"brand" | "vehicleType" | "color" | null>(null);

  const normalized = useMemo(() => normalizeDutchPlate(plateInput), [plateInput]);
  const isValid =
    normalized.length >= 6 &&
    brandInput.trim().length > 1 &&
    vehicleTypeInput.trim().length > 1 &&
    colorInput.trim().length > 1;

  return (
    <Screen
      title={state.setupComplete ? "Wijzig je voertuig" : "Registreer je voertuig"}
      eyebrow="Voertuig"
      subtitle="Voeg de belangrijkste gegevens toe waarmee andere bestuurders je auto veilig kunnen herkennen."
      footer={
        <Button
          label={state.setupComplete ? "Opslaan" : "Doorgaan"}
          disabled={!isValid}
          onPress={async () => {
            await registerVehicle({
              plate: plateInput,
              brand: brandInput,
              vehicleType: vehicleTypeInput,
              color: colorInput
            });
            if (state.setupComplete) {
              router.replace("/(tabs)/home");
              return;
            }

            router.push("/drive-start");
          }}
        />
      }
    >
      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={typography.label}>Nederlands kenteken</Text>
          <TextInput
            value={plateInput}
            onChangeText={setPlateInput}
            placeholder="12-AB-34"
            autoCapitalize="characters"
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
              paddingHorizontal: 16,
              paddingVertical: 14,
              fontSize: 18,
              color: palette.ink
            }}
          />
          <Text style={typography.caption}>Genormaliseerd voorbeeld: {normalized || "wacht op invoer"}</Text>
        </View>

        <SelectField
          label="Merk"
          value={brandInput}
          placeholder="Kies een automerk"
          options={commonEuropeanBrands}
          expanded={openSelect === "brand"}
          onToggle={() => setOpenSelect((current) => (current === "brand" ? null : "brand"))}
          onSelect={(value) => {
            setBrandInput(value);
            setOpenSelect(null);
          }}
        />

        <SelectField
          label="Voertuigtype"
          value={vehicleTypeInput}
          placeholder="Kies een voertuigtype"
          options={commonVehicleTypes}
          expanded={openSelect === "vehicleType"}
          onToggle={() => setOpenSelect((current) => (current === "vehicleType" ? null : "vehicleType"))}
          onSelect={(value) => {
            setVehicleTypeInput(value);
            setOpenSelect(null);
          }}
        />

        <SelectField
          label="Kleur"
          value={colorInput}
          placeholder="Kies een kleur"
          options={commonVehicleColors}
          expanded={openSelect === "color"}
          onToggle={() => setOpenSelect((current) => (current === "color" ? null : "color"))}
          onSelect={(value) => {
            setColorInput(value);
            setOpenSelect(null);
          }}
        />
      </View>
    </Screen>
  );
}
