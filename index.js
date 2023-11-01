const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173"], // change when in production
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ya8cack.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// middleware
const logger = async (req, res, next) => {
  console.log("Called: ", req.method, req.hostname, req.originalUrl);
  next();
};

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  // console.log("Value of token in middleware: ", token);
  if (!token) {
    return res.status(401).send({ auth: false, message: "Not authorized" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    // error
    if (err) {
      // console.log(err);
      return res.status(401).send({ message: "Unauthorized" });
    }
    // if token is valid then it would be decoded
    console.log("Value in the token: ", decoded);
    req.user = decoded;
    next();
  });
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("car-doctor");
    const servicesCollection = database.collection("services");
    const servicesOrderCollection = database.collection("servicesOrder");

    // auth related api
    app.post("/jwt", logger, async (req, res) => {
      try {
        const user = req.body;
        // console.log(user);
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        // console.log(token);
        res
          .cookie("token", token, {
            httpOnly: true,
            secure: false, // http://localhost:5173/login,
            sameSite: false,
          })
          .send({ success: true });
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    app.post("/logout", async (req, res) => {
      try {
        const user = req.body;
        console.log("logging out: ", user);
        res.clearCookie("token", { maxAge: 0 }).send({ success: true });
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    // access services collection data
    app.get("/services", logger, async (req, res) => {
      try {
        // exclude the things that we don't need
        const projection = {
          description: 0,
          facility: 0,
        };
        const cursor = servicesCollection.find().project(projection);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    // get service details or get to checkout based on unique service id
    app.get("/services/:id", logger, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        // finds and returns the only wanted things
        const options = {
          projection: { title: 1, price: 1, img: 1 },
        };
        const result = await servicesCollection.findOne(query, options);
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    // app.post("/services", async (req, res) => {
    //   try {
    //     const newService = req.body;
    //     // query to find all data in the collection
    //     const query = await servicesCollection.find().toArray();
    //     // check if there is already a service with that Name
    //     const found = query.find(
    //       (search) =>
    //         search.service_id === newService.service_id &&
    //         search.title === newService.title &&
    //         search.price === newService.price
    //     );
    //     console.log(found);
    //     if (found) {
    //       res.send({ message: "Already exists in DB" });
    //     }
    //     // insert a new service into the collection
    //     else {
    //       const result = await servicesCollection.insertOne(newService);
    //       res.send(result);
    //     }
    //   } catch (error) {
    //     console.log(error);
    //   }
    // });

    // same thing just another method
    app.post("/services", async (req, res) => {
      try {
        const newService = req.body;
        // find if there is already a same service in the collection
        const isAdded = await servicesCollection.findOne({
          service_id: newService.service_id,
          title: newService.title,
          price: newService.price,
        });
        if (isAdded) {
          return res.send({
            acknowledged: true,
            insertedId: isAdded._id,
            status: "Already exists in DB",
          });
        }
        // insert a new service into the collection
        const result = await servicesCollection.insertOne(newService);
        res.send({ ...result, status: "Added" });
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    // total services checked out
    app.get("/checkout", logger, verifyToken, async (req, res) => {
      try {
        // console.log("Token: ", req.cookies.token);
        // console.log("User in the valid token", req.user);
        if (req.query?.email !== req.user?.email) {
          return res
            .status(401)
            .send({ message: "Unauthorized Access Forbidden" });
        }
        let query = {};
        if (req.query?.email) {
          query = { email: req.query.email };
        }
        const result = await servicesOrderCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    app.post("/checkout", async (req, res) => {
      try {
        const order = req.body;
        const result = await servicesOrderCollection.insertOne(order);
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    app.patch("/checkout/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateQuery = {
          $set: {
            status: req.body.approved,
          },
        };
        const result = await servicesOrderCollection.updateOne(
          filter,
          updateQuery
        );
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    app.delete("/checkout/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await servicesOrderCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.log(error);
        return res.send({ error: true, message: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Car Doctor Server is Running!");
});

app.listen(port, () => {
  console.log(`Server started on ${port}`);
});
