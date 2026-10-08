import { router } from "expo-router";
import { Button, Heading, Page } from "../components/ui";
export default function NotFound() {
  return (
    <Page>
      <Heading title="That page isn’t here." />
      <Button title="Return to your lot" onPress={() => router.replace("/")} />
    </Page>
  );
}
