import Link from "next/link";
import { APP_NAME } from "@/lib/app-config";

const siteUrl = "https://vehicle-usage-management.vercel.app/";

export default function UserGuidePage() {
  return (
    <main className="guidePage">
      <Link aria-label="Back to dashboard" className="guideBackButton" href="/dashboard">
        Back
      </Link>

      <article className="guidePanel">
        <header className="guideHero">
          <p className="eyebrow">{APP_NAME}</p>
          <h1>User Guide</h1>
          <p className="heroLead">
            Save the link for future use:{" "}
            <a href={siteUrl} rel="noreferrer" target="_blank">
              {siteUrl}
            </a>
          </p>
        </header>

        <section className="guideSection" id="quick-decision-guide">
          <h2>Quick Decision Guide</h2>
          <p>Not sure what to do? Use this quick guide:</p>
          <ul>
            <li>Already collected the key -&gt; Borrow now</li>
            <li>Haven&apos;t collected the key yet -&gt; Reserve</li>
            <li>Finished using the vehicle -&gt; Return</li>
          </ul>
        </section>

        <section className="guideSection" id="important-first">
          <h2>Important First</h2>
          <p>Please follow these rules every time:</p>
          <ul>
            <li>Once you collect the vehicle key, you must start the borrow immediately, within a few minutes.</li>
            <li>A reservation alone is not enough.</li>
            <li>Create a reservation as early as possible if you know you&apos;ll need a vehicle.</li>
            <li>Always enter a clear purpose when reserving.</li>
          </ul>
          <p>This helps avoid conflicts and keeps vehicle usage transparent across the team.</p>
        </section>

        <section className="guideSection" id="typical-usage-flow">
          <h2>Typical Usage Flow</h2>
          <p>Reserve (Optional) -&gt; Collect Key -&gt; Start borrow -&gt; Use Vehicle -&gt; Return</p>
        </section>

        <section className="guideSection" id="what-the-system-does">
          <h2>What {APP_NAME} does</h2>
          <ul>
            <li>Borrow now: when you are using a vehicle immediately.</li>
            <li>Return: when you finish using a vehicle.</li>
            <li>Reserve: hold a vehicle for a future time.</li>
          </ul>
        </section>

        <section className="guideSection" id="login">
          <h2>Login</h2>
          <p>Use your company email to register and sign in.</p>
        </section>

        <section className="guideSection" id="borrow">
          <h2>Borrow now</h2>
          <h3>Use when</h3>
          <ul>
            <li>You have collected the vehicle key.</li>
            <li>The vehicle is now being used.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Borrow now page.</li>
            <li>Select the vehicle.</li>
            <li>Enter details, including purpose and expected return time.</li>
            <li>Submit.</li>
          </ol>
          <h3>Important</h3>
          <ul>
            <li>Start borrow immediately after collecting the key.</li>
            <li>Delays may cause reservation conflicts or tracking issues.</li>
          </ul>
          <h3>Extend</h3>
          <p>If you need more time, use Extend on the Borrow now page. Choose a later expected return time and enter a clear reason.</p>
          <p>If the new time conflicts with the next reservation, the extension will fail. Choose an earlier time or contact the team.</p>
          <h3>If blocked</h3>
          <p>This usually means the vehicle has an active reservation, or your time overlaps with an existing reservation.</p>
          <p>Choose another vehicle or time.</p>
        </section>

        <section className="guideSection" id="return">
          <h2>Return</h2>
          <h3>Use when</h3>
          <ul>
            <li>Vehicle use has finished.</li>
            <li>The key has been returned.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Return page.</li>
            <li>Select the vehicle.</li>
            <li>Submit return.</li>
          </ol>
          <h3>Important</h3>
          <p>You must complete Return after use. Otherwise, the vehicle will remain unavailable to others.</p>
        </section>

        <section className="guideSection" id="book">
          <h2>Reserve</h2>
          <h3>Use when</h3>
          <ul>
            <li>You want to reserve a vehicle in advance.</li>
          </ul>
          <h3>Steps</h3>
          <ol>
            <li>Open the Reserve page.</li>
            <li>Select the vehicle.</li>
            <li>Enter start and end time.</li>
            <li>Enter a clear purpose.</li>
            <li>Submit.</li>
          </ol>
          <h3>Important</h3>
          <ul>
            <li>A reservation holds the time slot.</li>
            <li>You must still select Start borrow when you collect the key.</li>
          </ul>
          <h3>Start borrow</h3>
          <p>If you already have a reservation and have collected the key, select Start borrow. {APP_NAME} will convert the reservation into an active borrow.</p>
          <h3>If blocked</h3>
          <p>This usually means the vehicle is already reserved, or your selected time overlaps.</p>
          <p>Choose another vehicle or adjust the time.</p>
        </section>

        <section className="guideSection" id="manage-your-bookings">
          <h2>Manage your reservations</h2>
          <p>Go to the dashboard -&gt; Your reservations.</p>
          <p>You can edit details, change time, or cancel reservations.</p>
        </section>

        <section className="guideSection" id="booking-rules">
          <h2>Reservation Rules</h2>
          <ul>
            <li>No overlapping reservations.</li>
            <li>Cannot borrow now during another active reservation.</li>
            <li>You can reserve a currently borrowed vehicle for a future time. If it has not been returned by then, both people are notified to coordinate.</li>
          </ul>
        </section>

        <section className="guideSection" id="common-mistakes-to-avoid">
          <h2>Common Mistakes to Avoid</h2>
          <ul>
            <li>Reservation only, without Start borrow.</li>
            <li>Using a vehicle without starting the borrow.</li>
            <li>Forgetting to Return.</li>
            <li>Entering unclear purpose.</li>
            <li>Incorrect time selection.</li>
          </ul>
          <p>These may cause conflicts or make vehicles unavailable to others.</p>
        </section>
      </article>
    </main>
  );
}
